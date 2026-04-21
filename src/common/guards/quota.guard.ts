import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BILLABLE_KEY, BillableMetadata } from '../decorators/billable.decorator';
import { SaasRequest } from '../types/request-context';
import { UsageKind } from '../../../generated/prisma';
import { UsageService } from '@/modules/usage/usage.service';
import { RateLimiterService } from '@/modules/usage/rate-limiter.service';

/**
 * Enforcement de la quota del plan + rate-limit específico por `kind`.
 *
 *  - `BILLABLE` → chequea `requestsLimit × graceFactor` del plan.
 *    Si está en el último 2% (gracia), marca warning en el request.
 *  - `PDF` → igual que BILLABLE **y** rate-limit `pdfRateLimitPerMin`.
 *  - `TA` → rate-limit `taRateLimitPerMin`, NO cuenta para quota.
 *  - `NON_BILLABLE` o sin decorador → pasa.
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usageService: UsageService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const billable = this.reflector.getAllAndOverride<BillableMetadata>(
      BILLABLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!billable || billable.kind === UsageKind.NON_BILLABLE) return true;

    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    const org = req.organization;
    if (!org) {
      // Si llegamos acá sin org resuelta, algo está mal cableado aguas arriba.
      throw new UnauthorizedException(
        'Endpoint marcado como billable pero el request no tiene organización resuelta (falta @ApiKeyAuth?)',
      );
    }

    // Rate-limit específico (antes del quota check, más barato):
    if (billable.kind === UsageKind.PDF) {
      await this.enforceRateLimit(`pdf:${org.id}`, org.pdfRateLimitPerMin);
    } else if (billable.kind === UsageKind.TA) {
      const keyId = req.apiKey?.id ?? org.id;
      await this.enforceRateLimit(`ta:${keyId}`, org.taRateLimitPerMin);
      return true; // TA no consume quota
    }

    // Quota (BILLABLE y PDF):
    const snapshot = await this.usageService.getCurrentSnapshot(org.id);
    const usedAfter = snapshot.billableCount + billable.cost;
    const effectiveLimit = Math.floor(org.requestsLimit * org.graceFactor);

    if (usedAfter > effectiveLimit) {
      throw new HttpException(
        {
          error: 'quota_exceeded',
          message: `Superaste el límite de tu plan "${org.planSlug}" (${org.requestsLimit} requests${
            org.graceFactor > 1
              ? ` + ${Math.round((org.graceFactor - 1) * 100)}% de gracia`
              : ''
          }). Subí de plan o esperá al próximo ciclo (${snapshot.periodEnd.toISOString()}).`,
          plan: org.planSlug,
          limit: org.requestsLimit,
          graceLimit: effectiveLimit,
          used: snapshot.billableCount,
          periodEnd: snapshot.periodEnd,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Quota específica de PDFs: límite adicional independiente de requestsLimit.
    if (billable.kind === UsageKind.PDF) {
      const pdfAfter = snapshot.pdfCount + billable.cost;
      if (pdfAfter > org.pdfLimit) {
        throw new HttpException(
          {
            error: 'pdf_quota_exceeded',
            message: `Superaste el límite de PDFs de tu plan "${org.planSlug}" (${org.pdfLimit}/mes). Contratá el addon de PDFs extras o subí de plan.`,
            plan: org.planSlug,
            pdfLimit: org.pdfLimit,
            pdfUsed: snapshot.pdfCount,
            periodEnd: snapshot.periodEnd,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    if (usedAfter > org.requestsLimit) {
      // Entró en zona de gracia: marcamos el request para que el interceptor
      // agregue el header/aviso en la respuesta.
      req._quotaWarning = 'grace';
    }

    return true;
  }

  private async enforceRateLimit(key: string, limitPerMin: number): Promise<void> {
    const ok = await this.rateLimiter.tryConsume(key, limitPerMin);
    if (!ok) {
      const retry = await this.rateLimiter.secondsUntilReset(key);
      throw new HttpException(
        {
          error: 'rate_limited',
          message: `Excediste el rate-limit (${limitPerMin}/min). Reintentá en ${retry}s.`,
          retryAfterSeconds: retry,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
