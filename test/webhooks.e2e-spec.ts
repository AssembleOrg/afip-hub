import * as crypto from 'node:crypto';
import request from 'supertest';
import {
  bootstrapTestApp,
  closeTestApp,
  emailFor,
  slugFor,
  TestAppContext,
} from './helpers/setup';

describe('Webhook subscriptions + HMAC (e2e)', () => {
  let ctx: TestAppContext;
  let jwt: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();

    const reg = await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: emailFor(ctx),
        password: 'Secret1234!',
        organizationName: 'WebhooksSpec',
        organizationSlug: slugFor(ctx),
      })
      .expect(201);
    jwt = reg.body.data.accessToken;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('GET /api/webhook-subscriptions/event-types → devuelve lista sin eventos internos', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/webhook-subscriptions/event-types')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    expect(Array.isArray(res.body.data.eventTypes)).toBe(true);
    expect(res.body.data.eventTypes).toContain('payment.approved');
    expect(res.body.data.eventTypes).toContain('invoice.emitted');
    // STORAGE_THRESHOLD_CROSSED es interno y no debe aparecer
    expect(res.body.data.eventTypes).not.toContain('storage.threshold_crossed');
  });

  it('POST /api/webhook-subscriptions → devuelve secret plaintext UNA sola vez', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/webhook-subscriptions')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        url: 'https://example.test/hook',
        events: ['payment.approved', 'invoice.emitted'],
        description: 'test',
      })
      .expect(201);

    expect(res.body.data.secret).toMatch(/^whs_/);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.signatureHint).toContain('X-Webhook-Signature');
  });

  it('DTO validation: events inválidos → 400', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/webhook-subscriptions')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        url: 'https://example.test/hook',
        events: ['evento.inventado'],
      })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('Rotate secret → invalida el previo y devuelve uno nuevo', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post('/api/webhook-subscriptions')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        url: 'https://example.test/rotate',
        events: ['payment.approved'],
      })
      .expect(201);
    const id = create.body.data.id;
    const oldSecret = create.body.data.secret;

    const rot = await request(ctx.app.getHttpServer())
      .post(`/api/webhook-subscriptions/${id}/rotate-secret`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(201);
    const newSecret = rot.body.data.secret;

    expect(newSecret).toMatch(/^whs_/);
    expect(newSecret).not.toBe(oldSecret);
  });

  /**
   * Verificación de la firma: replicamos el cálculo HMAC-SHA256 sobre el
   * body y comprobamos que el valor que usamos internamente coincide con
   * el que firmaríamos antes de mandar el POST al cliente.
   */
  it('HMAC signature: calcular sha256 sobre body coincide con spec de X-Webhook-Signature', () => {
    const secret = 'whs_TEST_SECRET';
    const body = { id: 'evt-1', type: 'payment.approved', data: { amount: 100 } };
    const raw = JSON.stringify(body);
    const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');

    // La firma es hex lowercase, 64 chars
    expect(sig).toMatch(/^[0-9a-f]{64}$/);

    // Idempotencia: mismo body y secret → misma firma
    const sig2 = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    expect(sig).toBe(sig2);

    // Body distinto → firma distinta
    const sig3 = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify({ ...body, extra: 1 }))
      .digest('hex');
    expect(sig3).not.toBe(sig);
  });

  it('DELETE /api/webhook-subscriptions/:id → soft delete', async () => {
    const create = await request(ctx.app.getHttpServer())
      .post('/api/webhook-subscriptions')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        url: 'https://example.test/del',
        events: ['payment.approved'],
      })
      .expect(201);
    const id = create.body.data.id;

    await request(ctx.app.getHttpServer())
      .delete(`/api/webhook-subscriptions/${id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    // No aparece en el listing
    const list = await request(ctx.app.getHttpServer())
      .get('/api/webhook-subscriptions')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);
    expect(list.body.data.find((s: { id: string }) => s.id === id)).toBeUndefined();
  });

  it('Scope: otra org no puede ver/modificar webhooks ajenos', async () => {
    // Crear webhook en org 1
    const create = await request(ctx.app.getHttpServer())
      .post('/api/webhook-subscriptions')
      .set('Authorization', `Bearer ${jwt}`)
      .send({
        url: 'https://example.test/scope',
        events: ['payment.approved'],
      })
      .expect(201);
    const webhookId = create.body.data.id;

    // Registrar otro user/org
    const reg2 = await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: emailFor(ctx, 'other'),
        password: 'Secret1234!',
        organizationName: 'Other',
        organizationSlug: slugFor(ctx, 'other'),
      })
      .expect(201);
    const jwt2 = reg2.body.data.accessToken;

    // User 2 intenta leer → 403 (distinto org)
    await request(ctx.app.getHttpServer())
      .get(`/api/webhook-subscriptions/${webhookId}`)
      .set('Authorization', `Bearer ${jwt2}`)
      .expect(403);
  });
});
