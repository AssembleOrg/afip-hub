import { SetMetadata } from '@nestjs/common';

export const IS_API_KEY_AUTH_KEY = 'isApiKeyAuth';

/**
 * Marca el endpoint para que se autentique con API key (header `x-api-key`
 * o `Authorization: Bearer ah_...`) en lugar del JWT del dashboard.
 */
export const ApiKeyAuth = () => SetMetadata(IS_API_KEY_AUTH_KEY, true);
