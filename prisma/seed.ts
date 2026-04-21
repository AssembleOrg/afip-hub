import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient, PlatformRole, PlanChannel } from '../generated/prisma';
// BillingPeriod no se usa en seed (subscriptions se crean en runtime)
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || '';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Precios base en USD. Editables en runtime desde el panel de admin.
// El ARS final = priceUsd × dolar blue venta (cache de ExchangeRate).
const PLANS = [
  // ── Free (ambos canales) ───────────────────────────────────────────────────
  {
    slug: 'free',
    name: 'Free',
    channel: PlanChannel.BOTH,
    description: '300 facturas/mes, 2 CUITs emisores. Acceso web + API.',
    priceUsd: 0,
    annualPriceUsd: 0,
    requestsLimit: 300,
    pdfLimit: 20,
    cuitLimit: 2,
    pdfRateLimitPerMin: 10,
    taRateLimitPerMin: 5,
    graceFactor: 1.0,
    features: { emailSupport: false, webhooks: false },
    isDefault: true,
    isPublic: true,
    isCustom: false,
    displayOrder: 1,
  },
  // ── Solo API ───────────────────────────────────────────────────────────────
  {
    slug: 'starter-api',
    name: 'Starter',
    channel: PlanChannel.API,
    description: '10k requests/mes, 10 CUITs emisores, 100 PDFs incluidos. Acceso API.',
    priceUsd: 15,
    annualPriceUsd: 150,
    requestsLimit: 10_000,
    pdfLimit: 100,
    cuitLimit: 10,
    pdfRateLimitPerMin: 30,
    taRateLimitPerMin: 10,
    graceFactor: 1.02,
    features: { emailSupport: true, webhooks: false },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 20,
  },
  {
    slug: 'growth-api',
    name: 'Growth',
    channel: PlanChannel.API,
    description: '100k requests/mes, 100 CUITs emisores, 200 PDFs incluidos. Webhooks. Acceso API.',
    priceUsd: 60,
    annualPriceUsd: 600,
    requestsLimit: 100_000,
    pdfLimit: 200,
    cuitLimit: 100,
    pdfRateLimitPerMin: 60,
    taRateLimitPerMin: 20,
    graceFactor: 1.02,
    features: { emailSupport: true, webhooks: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 30,
  },
  {
    slug: 'scale-api',
    name: 'Scale',
    channel: PlanChannel.API,
    description: '500k requests/mes, 400 CUITs emisores, 200 PDFs incluidos. Acceso API.',
    priceUsd: 130,
    annualPriceUsd: 1300,
    requestsLimit: 500_000,
    pdfLimit: 200,
    cuitLimit: 400,
    pdfRateLimitPerMin: 120,
    taRateLimitPerMin: 40,
    graceFactor: 1.02,
    features: { emailSupport: true, webhooks: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 40,
  },
  {
    slug: 'enterprise-api',
    name: 'Enterprise',
    channel: PlanChannel.API,
    description: '1M requests/mes, 1000 CUITs emisores, 250 PDFs incluidos. Soporte prioritario. Acceso API.',
    priceUsd: 200,
    annualPriceUsd: 2000,
    requestsLimit: 1_000_000,
    pdfLimit: 250,
    cuitLimit: 1000,
    pdfRateLimitPerMin: 300,
    taRateLimitPerMin: 100,
    graceFactor: 1.02,
    features: { emailSupport: true, webhooks: true, prioritySupport: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 50,
  },
  // ── API + Web ──────────────────────────────────────────────────────────────
  {
    slug: 'starter-web',
    name: 'Starter',
    channel: PlanChannel.WEB,
    description: '10k requests/mes, 10 CUITs emisores, 100 PDFs incluidos. Acceso web + API.',
    priceUsd: 22,
    annualPriceUsd: 220,
    requestsLimit: 10_000,
    pdfLimit: 100,
    cuitLimit: 10,
    pdfRateLimitPerMin: 30,
    taRateLimitPerMin: 10,
    graceFactor: 1.02,
    features: { emailSupport: true, webhooks: false },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 21,
  },
  {
    slug: 'growth-web',
    name: 'Growth',
    channel: PlanChannel.WEB,
    description: '100k requests/mes, 100 CUITs emisores, 200 PDFs incluidos. Webhooks. Acceso web + API.',
    priceUsd: 85,
    annualPriceUsd: 850,
    requestsLimit: 100_000,
    pdfLimit: 200,
    cuitLimit: 100,
    pdfRateLimitPerMin: 60,
    taRateLimitPerMin: 20,
    graceFactor: 1.02,
    features: { emailSupport: true, webhooks: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 31,
  },
  {
    slug: 'scale-web',
    name: 'Scale',
    channel: PlanChannel.WEB,
    description: '500k requests/mes, 400 CUITs emisores, 200 PDFs incluidos. Acceso web + API.',
    priceUsd: 170,
    annualPriceUsd: 1700,
    requestsLimit: 500_000,
    pdfLimit: 200,
    cuitLimit: 400,
    pdfRateLimitPerMin: 120,
    taRateLimitPerMin: 40,
    graceFactor: 1.02,
    features: { emailSupport: true, webhooks: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 41,
  },
  {
    slug: 'enterprise-web',
    name: 'Enterprise',
    channel: PlanChannel.WEB,
    description: '1M requests/mes, 1000 CUITs emisores, 250 PDFs incluidos. Soporte prioritario. Acceso web + API.',
    priceUsd: 245,
    annualPriceUsd: 2450,
    requestsLimit: 1_000_000,
    pdfLimit: 250,
    cuitLimit: 1000,
    pdfRateLimitPerMin: 300,
    taRateLimitPerMin: 100,
    graceFactor: 1.02,
    features: { emailSupport: true, webhooks: true, prioritySupport: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 51,
  },
  // ── Planes legacy (ocultos) ────────────────────────────────────────────────
  { slug: 'starter', name: 'Starter (legacy)', channel: PlanChannel.API, description: '', priceUsd: 15, annualPriceUsd: 150, requestsLimit: 10_000, pdfLimit: 100, cuitLimit: 10, pdfRateLimitPerMin: 30, taRateLimitPerMin: 10, graceFactor: 1.02, features: {}, isDefault: false, isPublic: false, isCustom: false, displayOrder: 99 },
  { slug: 'growth', name: 'Growth (legacy)', channel: PlanChannel.API, description: '', priceUsd: 60, annualPriceUsd: 600, requestsLimit: 100_000, pdfLimit: 200, cuitLimit: 100, pdfRateLimitPerMin: 60, taRateLimitPerMin: 20, graceFactor: 1.02, features: {}, isDefault: false, isPublic: false, isCustom: false, displayOrder: 99 },
  { slug: 'scale', name: 'Scale (legacy)', channel: PlanChannel.API, description: '', priceUsd: 130, annualPriceUsd: 1300, requestsLimit: 500_000, pdfLimit: 200, cuitLimit: 400, pdfRateLimitPerMin: 120, taRateLimitPerMin: 40, graceFactor: 1.02, features: {}, isDefault: false, isPublic: false, isCustom: false, displayOrder: 99 },
  { slug: 'enterprise', name: 'Enterprise (legacy)', channel: PlanChannel.API, description: '', priceUsd: 200, annualPriceUsd: 2000, requestsLimit: 1_000_000, pdfLimit: 250, cuitLimit: 1000, pdfRateLimitPerMin: 300, taRateLimitPerMin: 100, graceFactor: 1.02, features: {}, isDefault: false, isPublic: false, isCustom: false, displayOrder: 99 },
] as const;

const ADMIN_SETTINGS = [
  {
    key: 'billing.exchange_source',
    value: 'dolarapi_blue',
    description: 'Fuente de cotización para convertir USD → ARS',
  },
  {
    key: 'billing.exchange_cache_seconds',
    value: 900,
    description: 'TTL del cache de cotización (15 min)',
  },
  {
    key: 'billing.preapproval_cap_multiplier',
    value: 1.5,
    description:
      'Múltiplo del monto ARS autorizado como tope en MP preapproval',
  },
  {
    key: 'quota.default_grace_factor',
    value: 1.02,
    description: 'Gracia default aplicada a planes pagos si no tienen la suya',
  },
  {
    key: 'quota.warning_header_name',
    value: 'X-Usage-Warning',
    description: 'Nombre del header para avisar que entró en gracia',
  },
  {
    key: 'billing.trial_days',
    value: 14,
    description: 'Días de trial automático al registrarse (0 = sin trial)',
  },

  // Self-billing: facturación automática a nuestros subscribers.
  // Por default viene OFF — el admin tiene que subir su cert vía
  // POST /certificates y cargar el certificate_id acá.
  {
    key: 'platform_billing.enabled',
    value: false,
    description: 'Activar self-billing automático al aprobar cada Payment',
  },
  {
    key: 'platform_billing.certificate_id',
    value: '',
    description:
      'UUID del Certificate persistido cifrado que emite nuestras facturas (CUIT propio)',
  },
  {
    key: 'platform_billing.punto_venta',
    value: 1,
    description: 'Punto de venta habilitado en AFIP para emitir a subscribers',
  },
  {
    key: 'platform_billing.tipo_comprobante_default',
    value: 6,
    description:
      'Tipo de comprobante por default si el subscriber es consumidor final (6=Factura B, 11=C)',
  },
  {
    key: 'platform_billing.homologacion',
    value: true,
    description:
      'true=homologacion (pruebas sin efecto fiscal). Ponelo en false cuando tu cert sea de producción',
  },
  {
    key: 'platform_billing.concepto_template',
    value: 'Suscripción {planName} - {period}',
    description:
      'Template del concepto que aparece en la factura. Placeholders: {planName}, {period}',
  },
  {
    key: 'platform_billing.max_retries',
    value: 5,
    description:
      'Máximo de intentos antes de marcar la PlatformInvoice como ABANDONED',
  },
] as const;

async function seedPlans() {
  for (const plan of PLANS) {
    const { slug, ...data } = plan;
    await prisma.plan.upsert({
      where: { slug },
      update: data as any,
      create: plan as any,
    });
    console.log(`  plan "${slug}" listo`);
  }
}

async function seedAdminUser() {
  const email = process.env.ADMIN_EMAIL || 'admin@afip-hub.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      password: hashed,
      platformRole: PlatformRole.ADMIN,
    },
  });
  console.log(`  admin creado/actualizado: ${user.email}`);
}

async function seedAdminSettings() {
  for (const setting of ADMIN_SETTINGS) {
    await prisma.adminSetting.upsert({
      where: { key: setting.key },
      update: {
        description: setting.description,
      },
      create: {
        key: setting.key,
        value: setting.value as any,
        description: setting.description,
      },
    });
    console.log(`  setting "${setting.key}" listo`);
  }
}

async function main() {
  console.log('seeding plans...');
  await seedPlans();

  console.log('seeding admin user...');
  await seedAdminUser();

  console.log('seeding admin settings...');
  await seedAdminSettings();

  console.log('done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
