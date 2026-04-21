import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '@/app.module';
import { AfipService } from '@/modules/afip/afip.service';
import { EmailService } from '@/modules/email/email.service';
import { MercadoPagoService } from '@/modules/billing/mercadopago.service';
import { ResponseInterceptor, HttpExceptionFilter } from '@/common';
import { PrismaService } from '@/database/prisma.service';

export interface TestAppContext {
  app: INestApplication;
  module: TestingModule;
  prisma: PrismaService;
  /** Email suffix para identificar datos de cada test y limpiar después. */
  testTag: string;
}

/**
 * Stubs mínimos de servicios externos para no pegar a AFIP/MP/SMTP en tests.
 * Cada test puede sobreescribir vía `module.get(Service).method = jest.fn()`.
 */
const afipStub: Partial<AfipService> = {
  async createInvoice(dto: any) {
    return {
      cae: '00000000000000',
      caeFchVto: '20261231',
      puntoVenta: dto.puntoVenta ?? 1,
      tipoComprobante: dto.tipoComprobante ?? 6,
      numeroComprobante: 1,
      fechaComprobante: dto.fechaComprobante ?? '20260101',
      importeTotal: dto.importeTotal ?? 0,
      resultado: 'A',
      observaciones: [],
      observacionesDetalladas: [],
      cuitEmisor: dto.cuitEmisor ?? '20999999998',
    } as any;
  },
  async getTicket() {
    return {
      token: 'test-token',
      sign: 'test-sign',
      generationTime: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    } as any;
  },
  // Silenciamos los demás métodos (los tests que los usen los re-stubean)
} as any;

const emailStub: Partial<EmailService> = {
  async sendTemplate() {
    /* no-op */
  },
  async sendRaw() {
    /* no-op */
  },
} as any;

const mpStub: Partial<MercadoPagoService> = {
  isConfigured() {
    return false;
  },
  verifyWebhookSignature() {
    return true;
  },
} as any;

/**
 * Crea y arranca una app Nest para tests, con el pipeline de main.ts
 * replicado (ValidationPipe, filters, interceptors globales) y stubs para
 * servicios externos (AFIP / MP / Email).
 *
 * Devuelve `testTag` único para suffixear emails/slugs y así cada spec
 * pueda limpiar sus datos sin pisar otros.
 */
export async function bootstrapTestApp(): Promise<TestAppContext> {
  // Evita que OTel intente exportar traces durante tests.
  process.env.OTEL_TRACES_ENABLED = 'false';
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  // Evita validación fuerte de prod en tests.
  process.env.NODE_ENV = 'test';

  const module: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(AfipService)
    .useValue(afipStub)
    .overrideProvider(EmailService)
    .useValue(emailStub)
    .overrideProvider(MercadoPagoService)
    .useValue(mpStub)
    .setLogger(new Logger()) // Pino async puede colgar tests; usamos el default
    .compile();

  const app = module.createNestApplication({ bufferLogs: false });
  app.useLogger(false); // silencio total durante tests

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const prisma = module.get(PrismaService);
  const testTag = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return { app, module, prisma, testTag };
}

/**
 * Limpia todo lo creado por un test basado en su `testTag`. Borra en orden
 * de dependencias para respetar FKs. Si el testTag está incluido en el
 * email/slug de Users/Orgs, las cascadas hacen el resto.
 */
export async function cleanupByTag(
  prisma: PrismaService,
  testTag: string,
): Promise<void> {
  // Borramos orgs cuyo slug contenga el tag → cascade a apikeys, usage, invoices, etc.
  await prisma.organization.deleteMany({
    where: { slug: { contains: testTag } },
  });
  // Users standalone (sin org) que pertenezcan al test
  await prisma.user.deleteMany({
    where: { email: { contains: testTag } },
  });
}

export async function closeTestApp(ctx: TestAppContext): Promise<void> {
  await cleanupByTag(ctx.prisma, ctx.testTag).catch(() => undefined);
  await ctx.app.close();
}

export function emailFor(ctx: TestAppContext, prefix = 'user'): string {
  return `${prefix}+${ctx.testTag}@test.local`;
}

export function slugFor(ctx: TestAppContext, prefix = 'org'): string {
  return `${prefix}-${ctx.testTag.toLowerCase()}`;
}
