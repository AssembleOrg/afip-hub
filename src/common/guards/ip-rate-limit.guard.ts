import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimiterService } from '@/modules/usage/rate-limiter.service';
import { SaasRequest } from '../types/request-context';

const META_KEY = 'ipRateLimit';

interface IpRateLimitMeta {
  limitPerMin: number;
  bucket: string;
}

/**
 * Rate-limit por IP, pensado para endpoints públicos sensibles a fuerza bruta
 * (login, register, password-reset). Independiente de la quota de planes.
 */
export const IpRateLimit = (limitPerMin: number, bucket: string) =>
  SetMetadata(META_KEY, { limitPerMin, bucket } satisfies IpRateLimitMeta);

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<IpRateLimitMeta>(META_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!meta) return true;

    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    const ip = (req.ip || req.socket?.remoteAddress || 'unknown')
      .toString()
      .replace('::ffff:', ''); // IPv4-mapped → IPv4
    const key = `iprl:${meta.bucket}:${ip}`;

    const ok = await this.rateLimiter.tryConsume(key, meta.limitPerMin);
    if (!ok) {
      const retry = await this.rateLimiter.secondsUntilReset(key);
      throw new HttpException(
        {
          error: 'rate_limited',
          message: `Demasiados intentos. Reintentá en ${retry}s.`,
          retryAfterSeconds: retry,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
