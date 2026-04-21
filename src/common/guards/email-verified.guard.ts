import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@/database/prisma.service';
import { SaasRequest } from '../types/request-context';
import { REQUIRE_VERIFIED_KEY } from '../decorators/require-verified.decorator';

/**
 * Después de `SaasAuthGuard`. Si el endpoint tiene `@RequireVerified()` y el
 * user no tiene `emailVerifiedAt`, rechaza 403 con mensaje explícito.
 *
 * NO aplica a API keys (una API key válida no necesita email verificado —
 * la plataforma ya validó al crearla). Solo aplica al flujo JWT (dashboard).
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required) return true;

    const req = ctx.switchToHttp().getRequest<SaasRequest>();

    // Si vino por API key, pasa (emisión de la key ya implica plataforma-validada).
    if (req.apiKey) return true;

    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('Necesitás iniciar sesión para continuar');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });

    if (!user?.emailVerifiedAt) {
      throw new ForbiddenException({
        error: 'email_not_verified',
        message:
          'Para continuar necesitás verificar tu email. Revisá tu casilla de correo (incluido el spam) o pedí un nuevo enlace desde tu perfil.',
      });
    }
    return true;
  }
}
