/**
 * AFIP Environment URLs
 *
 * PRODUCCIÓN (facturas reales, fiscalmente válidas):
 * - WSAA: https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL
 * - WSFE: https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL
 * - Padrón A13: https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL
 * - Ventanilla Electrónica: https://infraestructura.afip.gob.ar/ve-ws/services/veconsumer?wsdl
 * - WSCDC: https://servicios1.arca.gov.ar/WSCDC/service.asmx?WSDL
 *
 * HOMOLOGACIÓN (testing, sin efecto fiscal):
 * - WSAA: https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL
 * - WSFE: https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL
 * - Padrón A13: https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL
 * - Ventanilla Electrónica: https://stable-middleware-tecno-ext.afip.gob.ar/ve-ws/services/veconsumer?wsdl
 * - WSCDC: https://wswhomo.arca.gov.ar/WSCDC/service.asmx?WSDL
 */

const isProduction = process.env.AFIP_ENVIRONMENT === 'production';

// Default to HOMOLOGACIÓN for safety (testing environment)
const AFIP_URLS = {
  production: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL',
    padron:
      'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL',
    ventanilla:
      'https://infraestructura.afip.gob.ar/ve-ws/services/veconsumer?wsdl',
    wscdc: 'https://servicios1.arca.gov.ar/WSCDC/service.asmx?WSDL',
  },
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL',
    padron:
      'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL',
    ventanilla:
      'https://stable-middleware-tecno-ext.afip.gob.ar/ve-ws/services/veconsumer?wsdl',
    wscdc: 'https://wswhomo.arca.gov.ar/WSCDC/service.asmx?WSDL',
  },
};

const afipEnv = isProduction ? AFIP_URLS.production : AFIP_URLS.homologacion;

const env_ = () => ({
  port: Number.parseInt(process.env.PORT || '3000', 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  database: {
    url: process.env.DATABASE_URL || '',
  },
  redis: {
    url: process.env.REDIS_URL || '',
  },
  certificates: {
    masterKey: process.env.CERT_MASTER_KEY || '',
    keyVersion:
      Number.parseInt(process.env.CERT_MASTER_KEY_VERSION || '1', 10) || 1,
  },
  storage: {
    // DO Spaces es S3-compatible. Ejemplo endpoint: https://nyc3.digitaloceanspaces.com
    endpoint: process.env.SPACES_ENDPOINT || '',
    region: process.env.SPACES_REGION || 'us-east-1',
    bucket: process.env.SPACES_BUCKET || '',
    key: process.env.SPACES_KEY || '',
    secret: process.env.SPACES_SECRET || '',
    prefix: process.env.SPACES_PREFIX || 'afip-hub',
  },
  retention: {
    usageEventsDays: Number.parseInt(
      process.env.RETENTION_USAGE_EVENTS_DAYS || '90',
      10,
    ),
    webhookDeliveriesDeliveredDays: Number.parseInt(
      process.env.RETENTION_WEBHOOK_OK_DAYS || '30',
      10,
    ),
    webhookDeliveriesFailedDays: Number.parseInt(
      process.env.RETENTION_WEBHOOK_FAIL_DAYS || '90',
      10,
    ),
    notificationDeliveriesDays: Number.parseInt(
      process.env.RETENTION_NOTIFICATIONS_DAYS || '90',
      10,
    ),
    scheduledTaskRunsDays: Number.parseInt(
      process.env.RETENTION_TASK_RUNS_DAYS || '90',
      10,
    ),
    exchangeRatesDays: Number.parseInt(
      process.env.RETENTION_EXCHANGE_DAYS || '7',
      10,
    ),
    invoiceArchiveAfterDays: Number.parseInt(
      process.env.RETENTION_INVOICE_ARCHIVE_DAYS || '180',
      10,
    ),
    auditLogsDays: Number.parseInt(
      process.env.RETENTION_AUDIT_DAYS || '395',
      10,
    ),
  },
  storageAlerts: {
    thresholds: (process.env.STORAGE_ALERT_THRESHOLDS || '60,80,90')
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n > 0 && n < 100),
    // Tamaño total del volumen en bytes (default Railway free tier = 50GB).
    volumeBytes: Number.parseInt(
      process.env.STORAGE_VOLUME_BYTES || String(50 * 1024 * 1024 * 1024),
      10,
    ),
  },
  metrics: {
    token: process.env.METRICS_TOKEN || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    refreshTokenDays: Number(process.env.JWT_REFRESH_DAYS || 30),
    refreshTokenAbsoluteDays: Number(process.env.JWT_REFRESH_ABSOLUTE_DAYS || 90),
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN || '',
    cookieSecure: process.env.NODE_ENV === 'production',
  },
  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
    password: process.env.SWAGGER_PASSWORD || 'admin',
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number.parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '0.0',
    ),
  },
  mercadopago: {
    accessToken: process.env.MP_ACCESS_TOKEN || '',
    webhookSecret: process.env.MP_WEBHOOK_SECRET || '',
    backSuccessUrl: process.env.MP_BACK_SUCCESS_URL || '',
    backFailureUrl: process.env.MP_BACK_FAILURE_URL || '',
    frequency: Number.parseInt(process.env.MP_FREQUENCY || '1', 10),
    frequencyType: process.env.MP_FREQUENCY_TYPE || 'months',
  },
  exchangeRate: {
    source:
      process.env.EXCHANGE_RATE_SOURCE ||
      'https://dolarapi.com/v1/dolares/blue',
    cronExpression: process.env.EXCHANGE_RATE_CRON || '*/15 * * * *',
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  email: {
    provider: (process.env.EMAIL_PROVIDER || 'brevo') as
      | 'brevo'
      | 'smtp'
      | 'console',
    fromEmail:
      process.env.EMAIL_FROM_ADDRESS ||
      process.env.BREVO_FROM_EMAIL ||
      'no-reply@afip-hub.com',
    fromName:
      process.env.EMAIL_FROM_NAME ||
      process.env.BREVO_FROM_NAME ||
      'AFIP Hub',
    replyTo: process.env.EMAIL_REPLY_TO || '',
    brevoApiKey: process.env.BREVO_API_KEY || '',
    host: process.env.SMTP_HOST || '',
    port: Number.parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
  },
  branding: {
    productName: process.env.BRAND_PRODUCT_NAME || 'AFIP Hub',
    primaryColor: process.env.BRAND_PRIMARY_COLOR || '#0F766E',
    logoUrl: process.env.BRAND_LOGO_URL || '',
    supportEmail: process.env.BRAND_SUPPORT_EMAIL || 'soporte@afip-hub.com',
    dashboardUrl:
      process.env.BRAND_DASHBOARD_URL ||
      process.env.PUBLIC_BASE_URL ||
      'http://localhost:3000',
  },
  verifyEmail: {
    tokenTtlHours: Number.parseInt(
      process.env.VERIFY_EMAIL_TTL_HOURS || '24',
      10,
    ),
    requireForBilling:
      process.env.VERIFY_EMAIL_REQUIRED_FOR_BILLING !== 'false',
    /** Cooldown para auto-reenvío en login. Si último token es más viejo que esto, reenvía. */
    autoResendCooldownHours: Number.parseInt(
      process.env.VERIFY_EMAIL_AUTO_RESEND_COOLDOWN_HOURS || '24',
      10,
    ),
  },
  passwordReset: {
    tokenTtlMinutes: Number.parseInt(
      process.env.PASSWORD_RESET_TTL_MINUTES || '60',
      10,
    ),
  },
  afip: {
    environment: isProduction ? 'production' : 'homologacion',
    wsaaUrl: process.env.AFIP_WSAA_URL || afipEnv.wsaa,
    wsfeUrl: process.env.AFIP_WSFE_URL || afipEnv.wsfe,
    padronUrl: process.env.AFIP_PADRON_URL || afipEnv.padron,
    ventanillaUrl: process.env.AFIP_VENTANILLA_URL || afipEnv.ventanilla,
    wscdcUrl: process.env.AFIP_WSCDC_URL || afipEnv.wscdc,
    certPath: process.env.AFIP_CERT_PATH || '',
    keyPath: process.env.AFIP_KEY_PATH || '',
    cuit: process.env.AFIP_CUIT || '',
    /** Ruta del archivo para persistir caché de tickets AFIP (sobrevive reinicios). Vacío = no persistir. */
    ticketCachePath: process.env.AFIP_TICKET_CACHE_PATH || '',
  },
  masterPadron: {
    // Opcional: fallback legacy. Preferir cargar vía PUT /admin/platform-cert (cifrado en DB).
    cuit: process.env.MASTER_PADRON_CUIT || '',
    certificate: process.env.MASTER_PADRON_CERT || '',
    privateKey: process.env.MASTER_PADRON_KEY || '',
  },
  timezone: 'America/Argentina/Buenos_Aires', // GMT-3
});
export default env_;
