import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_KEY = 'requireVerified';

/**
 * Marca un endpoint como requiriendo email verificado. El `EmailVerifiedGuard`
 * rechaza 403 si el user autenticado no tiene `emailVerifiedAt` seteado.
 *
 * Usar en endpoints sensibles: contratación de plan pago, addons, cambios
 * críticos de seguridad, etc.
 */
export const RequireVerified = () => SetMetadata(REQUIRE_VERIFIED_KEY, true);
