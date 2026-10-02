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
    description: '100 comprobantes/mes, 2 CUITs emisores, 20 PDFs. Sin excedente. Acceso web + API.',
    priceUsd: 0,
    annualPriceUsd: 0,
    requestsLimit: 100,
    pdfLimit: 20,
    cuitLimit: 2,
    pdfRateLimitPerMin: 10,
    taRateLimitPerMin: 5,
    graceFactor: 1.0,
    overagePriceUsd: 0,
    pdfOveragePriceUsd: 0,
    overageCapFactor: 3,
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
    description: '1.000 comprobantes/mes, 5 CUITs emisores, 100 PDFs. Excedente USD 0,02 por comprobante. Acceso API.',
    priceUsd: 15,
    annualPriceUsd: 150,
    requestsLimit: 1000,
    pdfLimit: 100,
    cuitLimit: 5,
    pdfRateLimitPerMin: 30,
    taRateLimitPerMin: 10,
    graceFactor: 1.02,
    overagePriceUsd: 0.02,
    pdfOveragePriceUsd: 0.05,
    overageCapFactor: 3,
    features: { emailSupport: true, webhooks: false },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 20,
  },
  {
    slug: 'growth-api',
    name: 'Pro',
    channel: PlanChannel.API,
    description: '5.000 comprobantes/mes, 20 CUITs emisores, 500 PDFs. Excedente USD 0,01 por comprobante. Acceso API.',
    priceUsd: 39,
    annualPriceUsd: 390,
    requestsLimit: 5000,
    pdfLimit: 500,
    cuitLimit: 20,
    pdfRateLimitPerMin: 60,
    taRateLimitPerMin: 20,
    graceFactor: 1.02,
    overagePriceUsd: 0.01,
    pdfOveragePriceUsd: 0.04,
    overageCapFactor: 3,
    features: { emailSupport: true, webhooks: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 30,
  },
  {
    slug: 'scale-api',
    name: 'Estudio',
    channel: PlanChannel.API,
    description: '20.000 comprobantes/mes, 75 CUITs emisores, 2.000 PDFs. Excedente USD 0,008 por comprobante. Acceso API.',
    priceUsd: 99,
    annualPriceUsd: 990,
    requestsLimit: 20000,
    pdfLimit: 2000,
    cuitLimit: 75,
    pdfRateLimitPerMin: 120,
    taRateLimitPerMin: 40,
    graceFactor: 1.02,
    overagePriceUsd: 0.008,
    pdfOveragePriceUsd: 0.03,
    overageCapFactor: 3,
    features: { emailSupport: true, webhooks: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 40,
  },
  {
    slug: 'enterprise-api',
    name: 'Escala',
    channel: PlanChannel.API,
    description: '75.000 comprobantes/mes, 250 CUITs emisores, 5.000 PDFs. Excedente USD 0,005 por comprobante. Acceso API.',
    priceUsd: 249,
    annualPriceUsd: 2490,
    requestsLimit: 75000,
    pdfLimit: 5000,
    cuitLimit: 250,
    pdfRateLimitPerMin: 300,
    taRateLimitPerMin: 100,
    graceFactor: 1.02,
    overagePriceUsd: 0.005,
    pdfOveragePriceUsd: 0.02,
    overageCapFactor: 3,
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
    description: '1.000 comprobantes/mes, 5 CUITs emisores, 100 PDFs. Excedente USD 0,02 por comprobante. Web + API.',
    priceUsd: 22,
    annualPriceUsd: 220,
    requestsLimit: 1000,
    pdfLimit: 100,
    cuitLimit: 5,
    pdfRateLimitPerMin: 30,
    taRateLimitPerMin: 10,
    graceFactor: 1.02,
    overagePriceUsd: 0.02,
    pdfOveragePriceUsd: 0.05,
    overageCapFactor: 3,
    features: { emailSupport: true, webhooks: false },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 21,
  },
  {
    slug: 'growth-web',
    name: 'Pro',
    channel: PlanChannel.WEB,
    description: '5.000 comprobantes/mes, 20 CUITs emisores, 500 PDFs. Excedente USD 0,01 por comprobante. Web + API.',
    priceUsd: 55,
    annualPriceUsd: 550,
    requestsLimit: 5000,
    pdfLimit: 500,
    cuitLimit: 20,
    pdfRateLimitPerMin: 60,
    taRateLimitPerMin: 20,
    graceFactor: 1.02,
    overagePriceUsd: 0.01,
    pdfOveragePriceUsd: 0.04,
    overageCapFactor: 3,
    features: { emailSupport: true, webhooks: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 31,
  },
  {
    slug: 'scale-web',
    name: 'Estudio',
    channel: PlanChannel.WEB,
    description: '20.000 comprobantes/mes, 75 CUITs emisores, 2.000 PDFs. Excedente USD 0,008 por comprobante. Web + API.',
    priceUsd: 129,
    annualPriceUsd: 1290,
    requestsLimit: 20000,
    pdfLimit: 2000,
    cuitLimit: 75,
    pdfRateLimitPerMin: 120,
    taRateLimitPerMin: 40,
    graceFactor: 1.02,
    overagePriceUsd: 0.008,
    pdfOveragePriceUsd: 0.03,
    overageCapFactor: 3,
    features: { emailSupport: true, webhooks: true },
    isDefault: false,
    isPublic: true,
    isCustom: false,
    displayOrder: 41,
  },
  {
    slug: 'enterprise-web',
    name: 'Escala',
    channel: PlanChannel.WEB,
    description: '75.000 comprobantes/mes, 250 CUITs emisores, 5.000 PDFs. Excedente USD 0,005 por comprobante. Web + API.',
    priceUsd: 299,
    annualPriceUsd: 2990,
    requestsLimit: 75000,
    pdfLimit: 5000,
    cuitLimit: 250,
    pdfRateLimitPerMin: 300,
    taRateLimitPerMin: 100,
    graceFactor: 1.02,
    overagePriceUsd: 0.005,
    pdfOveragePriceUsd: 0.02,
    overageCapFactor: 3,
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
