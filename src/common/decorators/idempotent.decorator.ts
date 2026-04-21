import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Marca el endpoint como idempotente: si el cliente envía el header
 * `Idempotency-Key`, cacheamos la respuesta exitosa por 24h y devolvemos la
 * misma si reintenta con la misma key + mismo body. Conflicto (mismo key,
 * body distinto) → 409.
 *
 * Crítico para `POST /afip/invoice` y similares donde un timeout del cliente
 * podría causar doble emisión en AFIP.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
