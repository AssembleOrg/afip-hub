import request from 'supertest';
import {
  bootstrapTestApp,
  closeTestApp,
  emailFor,
  slugFor,
  TestAppContext,
} from './helpers/setup';

/**
 * Valida el stack de guards + interceptors con AFIP stubeado:
 *  - CuitLimitGuard: requiere Emisor VALIDATED registrado; 403 si no existe
 *  - IdempotencyInterceptor: mismo key + body → replay; mismo key + body distinto → 409
 *  - UsageCounterInterceptor: cuenta requests después de success
 *
 * Bajo la nueva arquitectura los emisores NO se auto-registran al facturar:
 * hay que crearlos explícitamente (y validarlos contra AFIP) antes. En estos
 * tests insertamos el Emisor directo via Prisma con status VALIDATED para
 * testear el guard sin pasar por el flow de validación AFIP.
 */
describe('Guards + Interceptors (e2e)', () => {
  let ctx: TestAppContext;
  let jwt: string;
  let apiKey: string;
  let orgId: string;

  // Body válido para /afip/invoice (AfipService está stubeado para devolver CAE)
  const validInvoiceBody = {
    puntoVenta: 1,
    tipoComprobante: 6,
    numeroComprobante: 1,
    fechaComprobante: '20260101',
    cuitCliente: '20111111112',
    tipoDocumento: 80,
    condicionIvaReceptor: 1,
    concepto: 1,
    importeNetoGravado: 100,
    importeNetoNoGravado: 0,
    importeExento: 0,
    importeIva: 21,
    importeTributos: 0,
    importeTotal: 121,
    cuitEmisor: '20999999998',
    certificado: 'x-cert',
    clavePrivada: 'x-key',
  };

  beforeAll(async () => {
    ctx = await bootstrapTestApp();

    const reg = await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: emailFor(ctx),
        password: 'Secret1234!',
        organizationName: 'Guards',
        organizationSlug: slugFor(ctx),
      })
      .expect(201);
    jwt = reg.body.data.accessToken;
    orgId = reg.body.data.user.organizationId;

    const keyRes = await request(ctx.app.getHttpServer())
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name: 'guards-test' })
      .expect(201);
    apiKey = keyRes.body.data.key;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('CuitLimitGuard: 403 si el emisor no está registrado', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/afip/invoice')
      .set('x-api-key', apiKey)
      .send(validInvoiceBody)
      .expect(403);
    expect(res.body.message).toMatch(/emisor_not_registered|no está registrado/i);
  });

  it('CuitLimitGuard: con Emisor VALIDATED pre-registrado permite facturar', async () => {
    await ctx.prisma.emisor.create({
      data: {
        organizationId: orgId,
        cuit: '20999999998',
        validationStatus: 'VALIDATED',
        validatedAt: new Date(),
      },
    });

    await request(ctx.app.getHttpServer())
      .post('/api/afip/invoice')
      .set('x-api-key', apiKey)
      .send(validInvoiceBody)
      .expect(200);

    const emisor = await ctx.prisma.emisor.findFirst({
      where: { organizationId: orgId, cuit: '20999999998' },
    });
    expect(emisor).not.toBeNull();
    expect(emisor?.requestCount).toBeGreaterThan(0);
  });

  it('CuitLimitGuard: un Emisor PENDING/FAILED también da 403', async () => {
    await ctx.prisma.emisor.create({
      data: {
        organizationId: orgId,
        cuit: '20888888887',
        validationStatus: 'PENDING',
      },
    });

    const body = { ...validInvoiceBody, cuitEmisor: '20888888887' };
    const res = await request(ctx.app.getHttpServer())
      .post('/api/afip/invoice')
      .set('x-api-key', apiKey)
      .send(body)
      .expect(403);
    expect(res.body.message).toMatch(/emisor_not_registered|no está registrado/i);
  });

  it('Idempotency: mismo key + mismo body → replay (mismo status)', async () => {
    const key = `idem-${ctx.testTag}-1`;
    const r1 = await request(ctx.app.getHttpServer())
      .post('/api/afip/invoice')
      .set('x-api-key', apiKey)
      .set('Idempotency-Key', key)
      .send(validInvoiceBody)
      .expect(200);

    const r2 = await request(ctx.app.getHttpServer())
      .post('/api/afip/invoice')
      .set('x-api-key', apiKey)
      .set('Idempotency-Key', key)
      .send(validInvoiceBody);

    expect(r2.status).toBe(200);
    expect(r2.headers['x-idempotent-replay']).toBe('true');
    expect(r2.body).toEqual(r1.body);
  });

  it('Idempotency: mismo key + body distinto → 409', async () => {
    const key = `idem-${ctx.testTag}-conflict`;
    await request(ctx.app.getHttpServer())
      .post('/api/afip/invoice')
      .set('x-api-key', apiKey)
      .set('Idempotency-Key', key)
      .send(validInvoiceBody)
      .expect(200);

    const res = await request(ctx.app.getHttpServer())
      .post('/api/afip/invoice')
      .set('x-api-key', apiKey)
      .set('Idempotency-Key', key)
      .send({ ...validInvoiceBody, importeTotal: 999 })
      .expect(409);
    expect(res.body.message).toMatch(/idempotency|body/i);
  });

  it('UsageCounterInterceptor: el counter sube después de un request exitoso', async () => {
    const before = await ctx.prisma.usageCounter.findFirst({
      where: { organizationId: orgId },
    });
    const beforeCount = before?.billableCount ?? 0;

    await request(ctx.app.getHttpServer())
      .post('/api/afip/invoice')
      .set('x-api-key', apiKey)
      .send(validInvoiceBody)
      .expect(200);

    // Interceptor corre async — esperamos un poco
    await new Promise((r) => setTimeout(r, 500));

    const after = await ctx.prisma.usageCounter.findFirst({
      where: { organizationId: orgId },
    });
    expect((after?.billableCount ?? 0)).toBeGreaterThan(beforeCount);
  });
});
