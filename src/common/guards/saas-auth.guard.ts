import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_API_KEY_AUTH_KEY } from '../decorators/api-key-auth.decorator';
import { WEB_ONLY_KEY } from '../decorators/web-only.decorator';
import { ApiKeysService } from '@/modules/api-keys/api-keys.service';
import { SaasRequest } from '../types/request-context';

/**
 * Guard global. Decide el método de autenticación por metadata:
 *  - `@Public()` → pasa sin validar
 *  - `@ApiKeyAuth()` → valida header `x-api-key` o `Authorization: Bearer ah_...`
 *  - resto → JWT del dashboard (passport-jwt)
 */
@Injectable()
export class SaasAuthGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeysService: ApiKeysService,
  ) {
    super();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const isApiKey = this.reflector.getAllAndOverride<boolean>(
      IS_API_KEY_AUTH_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (isApiKey) {
      await this.validateApiKey(ctx);
      this.assertNotWebOnly(ctx);
      return true;
    }

    // Default: JWT
    return (await super.canActivate(ctx)) as boolean;
  }

  /** Por defecto passport-jwt lanza si no hay user; preservamos ese contrato. */
  handleRequest(err: any, user: any, _info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('No autorizado');
    }
    return user;
  }

  private async validateApiKey(ctx: ExecutionContext): Promise<void> {
    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    const raw = this.extractApiKey(req);
    const ip = (req.ip || req.socket?.remoteAddress || '').toString();

    const { apiKey, org } = await this.apiKeysService.resolveForRequest(raw, ip);
    req.apiKey = apiKey;
    req.organization = org;
    // Dejamos req.user en undefined: no hay usuario humano detrás de una key.
  }

  private assertNotWebOnly(ctx: ExecutionContext): void {
    const isWebOnly = this.reflector.getAllAndOverride<boolean>(WEB_ONLY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isWebOnly) {
      throw new ForbiddenException('Este endpoint solo está disponible desde el panel web.');
    }
  }

  private extractApiKey(req: SaasRequest): string {
    const header = req.headers['x-api-key'];
    if (typeof header === 'string' && header.length > 0) return header.trim();

    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token.startsWith('ah_')) return token;
    }
    return '';
  }
}
