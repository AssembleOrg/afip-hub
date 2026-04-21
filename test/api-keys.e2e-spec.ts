import request from 'supertest';
import {
  bootstrapTestApp,
  closeTestApp,
  emailFor,
  slugFor,
  TestAppContext,
} from './helpers/setup';

describe('ApiKeys + SaasAuthGuard (e2e)', () => {
  let ctx: TestAppContext;
  let jwt: string;
  let apiKey: string;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();

    const reg = await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: emailFor(ctx),
        password: 'Secret1234!',
        organizationName: 'KeyOrg',
        organizationSlug: slugFor(ctx),
      })
      .expect(201);
    jwt = reg.body.data.accessToken;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('POST /api/api-keys → devuelve secret plaintext UNA vez', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name: 'test-key' })
      .expect(201);

    expect(res.body.data.key).toMatch(/^ah_(test|live)_/);
    expect(res.body.data.prefix).toHaveLength(12);
    apiKey = res.body.data.key;
  });

  it('GET /api/api-keys → lista sin key plaintext', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].key).toBeUndefined();
    expect(res.body.data[0].hashedKey).toBeUndefined();
    expect(res.body.data[0].prefix).toBeDefined();
  });

  it('SaasAuthGuard: endpoint AFIP sin api-key → 401', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/afip/consultar-contribuyente')
      .send({})
      .expect(401);
  });

  it('SaasAuthGuard: api-key inválida → 401', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/afip/consultar-contribuyente')
      .set('x-api-key', 'ah_test_FAKE_INVALID_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
      .send({})
      .expect(401);
  });

  it('SaasAuthGuard: api-key válida pasa (falla solo por DTO validation)', async () => {
    // Sin body válido → 400 de validation, pero llega al controller → auth OK.
    const res = await request(ctx.app.getHttpServer())
      .post('/api/afip/consultar-contribuyente')
      .set('x-api-key', apiKey)
      .send({});
    expect([400, 422]).toContain(res.status);
  });

  it('DELETE /api/api-keys/:id → revoca y el key queda inválido', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ name: 'to-revoke' })
      .expect(201);
    const { id, key } = created.body.data;

    await request(ctx.app.getHttpServer())
      .delete(`/api/api-keys/${id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .expect(200);

    // Usarla ahora debe dar 401 (revoked)
    await request(ctx.app.getHttpServer())
      .post('/api/afip/consultar-contribuyente')
      .set('x-api-key', key)
      .send({ cuit: '20999999998' })
      .expect(401);
  });
});
