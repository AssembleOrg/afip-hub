import * as Sentry from '@sentry/node';

let initialized = false;

/**
 * Inicializa Sentry si hay `SENTRY_DSN`. Es idempotente. Pensado para llamarse
 * al principio de `main.ts`, antes de crear el `NestFactory`, para capturar
 * errores tempranos del bootstrap.
 */
export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    tracesSampleRate: Number.parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '0.0',
    ),
  });

  initialized = true;
  return true;
}

export { Sentry };
