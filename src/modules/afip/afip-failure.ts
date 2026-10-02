import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

/**
 * Fallas de infraestructura al hablar con ARCA (no responde, timeout, se cae
 * la conexión, devuelve un 5xx o una página de error en vez de SOAP). No son
 * culpa del cliente: van como 503 para que se puedan reintentar y para que el
 * monitoreo y la compensación de cupo las cuenten como fallas nuestras.
 */
const INFRA_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

const INFRA_MESSAGE =
  /timeout|timed out|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo|Service Unavailable|Bad Gateway|Gateway Time-?out|\b50[234]\b|no disponible|Cannot parse response/i;

export function isAfipInfraError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; response?: { status?: number } };
  if (e?.code && INFRA_CODES.has(e.code)) return true;
  if (typeof e?.response?.status === 'number' && e.response.status >= 500) return true;
  return typeof e?.message === 'string' && INFRA_MESSAGE.test(e.message);
}

/** 503 si ARCA/la red falló; 400 si el problema está en los datos del pedido. */
export function afipFailure(error: unknown, message: string) {
  return isAfipInfraError(error)
    ? new ServiceUnavailableException(`ARCA no está respondiendo. ${message}`)
    : new BadRequestException(message);
}
