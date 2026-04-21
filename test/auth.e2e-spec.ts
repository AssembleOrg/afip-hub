import request from 'supertest';
import {
  bootstrapTestApp,
  closeTestApp,
  emailFor,
  slugFor,
  TestAppContext,
} from './helpers/setup';

describe('Auth (e2e)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('POST /api/auth/register → crea user + org + devuelve JWT', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: emailFor(ctx, 'a'),
        password: 'TestPass1234!',
        organizationName: 'AuthSpec Org',
        organizationSlug: slugFor(ctx, 'auth-a'),
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.email).toContain('@test.local');
    expect(res.body.data.organization.planSlug).toBe('free');
    expect(res.body.data.user.orgRole).toBe('OWNER');
  });

  it('POST /api/auth/register → 409 si email ya existe', async () => {
    const email = emailFor(ctx, 'dup');
    const slug = slugFor(ctx, 'dup');
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password: 'TestPass1234!',
        organizationName: 'X',
        organizationSlug: slug,
      })
      .expect(201);

    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password: 'TestPass1234!',
        organizationName: 'Y',
        organizationSlug: `${slug}-2`,
      })
      .expect(409);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/auth/login → OK con credenciales correctas', async () => {
    const email = emailFor(ctx, 'login');
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password: 'Good1234!',
        organizationName: 'L',
        organizationSlug: slugFor(ctx, 'login'),
      })
      .expect(201);

    const res = await request(ctx.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Good1234!' })
      .expect(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('POST /api/auth/login → 401 con password incorrecto', async () => {
    const email = emailFor(ctx, 'bad');
    await request(ctx.app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email,
        password: 'RealPass1234!',
        organizationName: 'B',
        organizationSlug: slugFor(ctx, 'bad'),
      })
      .expect(201);

    await request(ctx.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
  });

  it('POST /api/auth/forgot-password → siempre 200 (anti-enumeration)', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'inexistente@test.local' })
      .expect(200);

    await request(ctx.app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: emailFor(ctx, 'login') })
      .expect(200);
  });

  it('IpRateLimit: /api/auth/login bloquea tras 10 intentos en 1 min', async () => {
    // El guard limita por IP; supertest usa siempre la misma.
    const attempts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'rl@test.local', password: 'whatever' });
      attempts.push(res.status);
    }
    // Los primeros 10 pueden ser 401/400 (auth falla), después 429 (rate-limit).
    const rateLimited = attempts.filter((s) => s === 429);
    expect(rateLimited.length).toBeGreaterThanOrEqual(1);
  });
});
