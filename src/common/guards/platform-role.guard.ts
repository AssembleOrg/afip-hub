import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../decorators/platform-role.decorator';
import { PlatformRole } from '../../../generated/prisma';
import { SaasRequest } from '../types/request-context';

/**
 * Exige que el JWT del request tenga un `platformRole` dentro de la lista
 * declarada con `@RequirePlatformRole(...)`. Usarlo después del guard global.
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRole[]>(
      PLATFORM_ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    const user = req.user;
    if (!user || !user.platformRole) {
      throw new ForbiddenException('Se requiere rol de plataforma');
    }
    if (!required.includes(user.platformRole)) {
      throw new ForbiddenException(
        `Rol requerido: ${required.join(' o ')}; actual: ${user.platformRole}`,
      );
    }
    return true;
  }
}
