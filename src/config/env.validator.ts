import * as dotenv from 'dotenv';

/**
 * Validator de env vars que corre **antes** de bootstrap. Fallar acá es
 * mejor que arrancar con configuración insegura y descubrirlo en runtime.
 *
 * Reglas críticas en producción:
 *  - `DATABASE_URL` requerido
 *  - `JWT_SECRET` no puede ser el placeholder default
 *  - Si hay billing activo (`MP_ACCESS_TOKEN`), también requerimos `MP_WEBHOOK_SECRET`
 *  - `CORS_ORIGINS` requerido (no aceptamos `*` en prod)
 */
const PROD_PROHIBITED_JWT_SECRETS = new Set([
  'your-secret-key',
  'change-me',
  'secret',
  '',
]);

function isValidCertificateMasterKey(value: string | undefined): boolean {
  if (!value) return false;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;

  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}

function isLikelyBrevoApiKey(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().replace(/^"+|"+$/g, '');
  return v.startsWith('xkeysib-') && v.length >= 40;
}

export function validateEnv(): void {
  // ConfigModule de Nest lee .env, pero corre después; nosotros validamos antes
  // del bootstrap, así que cargamos .env nosotros mismos. dotenv es idempotente:
  // no sobreescribe vars ya seteadas en el ambiente real (Railway/Docker).
  dotenv.config({ override: false });

  const env = process.env.NODE_ENV || 'development';
  const isProd = env === 'production';

  const errors: string[] = [];

  // Universal
  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL es obligatorio.');
  }

  if (isProd) {
    const jwt = process.env.JWT_SECRET || '';
    if (PROD_PROHIBITED_JWT_SECRETS.has(jwt)) {
      errors.push(
        'JWT_SECRET es el placeholder default. Generá uno random: `openssl rand -hex 64`.',
      );
    }
    if (jwt.length < 32) {
      errors.push('JWT_SECRET debe tener al menos 32 caracteres en producción.');
    }

    if (!process.env.CORS_ORIGINS) {
      errors.push(
        'CORS_ORIGINS es obligatorio en producción (lista separada por coma).',
      );
    } else if (process.env.CORS_ORIGINS.trim() === '*') {
      errors.push('CORS_ORIGINS=`*` no permitido en producción.');
    }

    if (process.env.MP_ACCESS_TOKEN && !process.env.MP_WEBHOOK_SECRET) {
      errors.push(
        'Si MP_ACCESS_TOKEN está seteado, MP_WEBHOOK_SECRET también es obligatorio (validación HMAC del webhook).',
      );
    }

    const emailProvider = (process.env.EMAIL_PROVIDER || 'brevo')
      .trim()
      .toLowerCase()
      .replace(/^"+|"+$/g, '');
    if (emailProvider === 'brevo') {
      if (!process.env.BREVO_API_KEY) {
        errors.push(
          'EMAIL_PROVIDER=brevo requiere BREVO_API_KEY.',
        );
      } else if (!isLikelyBrevoApiKey(process.env.BREVO_API_KEY)) {
        errors.push(
          'BREVO_API_KEY no parece válida (formato esperado: xkeysib-...).',
        );
      }
    }

    if (
      process.env.AFIP_ENVIRONMENT === 'production' &&
      !process.env.SENTRY_DSN
    ) {
      // No fatal, pero logueamos.
      console.warn(
        '[env] WARN: AFIP_ENVIRONMENT=production sin SENTRY_DSN. Sin error tracking, los fallos quedarán solo en logs.',
      );
    }

    if (!isValidCertificateMasterKey(process.env.CERT_MASTER_KEY)) {
      errors.push(
        'CERT_MASTER_KEY es obligatorio en producción y debe ser una clave AES-256 válida (32 bytes en base64 o 64 hex chars).',
      );
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ Configuración inválida (NODE_ENV=' + env + '):');
    for (const e of errors) console.error('  - ' + e);
    console.error('');
    process.exit(1);
  }
}
