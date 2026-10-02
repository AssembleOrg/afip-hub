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
import { ResolvedOrganization, SaasRequest } from '../types/request-context';
import { SubscriptionStatus, UsageKind } from '../../../generated/prisma';
import { UsageService } from '@/modules/usage/usage.service';
import { RateLimiterService } from '@/modules/usage/rate-limiter.service';
import { ApiKeysService } from '@/modules/api-keys/api-keys.service';

/**
 * Enforcement del cupo del plan + rate-limit específico por `kind`.
 *
 *  - `BILLABLE` (emite comprobante) → cupo `requestsLimit` (comprobantes/mes).
 *    Si el plan cobra excedente y la suscripción está activa, se sigue
 *    emitiendo por encima del cupo (se cobra en el próximo débito) hasta el
 *    techo `requestsLimit × overageCapFactor`. Sin excedente (Free), corta en
 *    `requestsLimit × graceFactor`.
 *  - `PDF` → mismo esquema contra `pdfLimit` + rate-limit `pdfRateLimitPerMin`.
 *  - `CONSULTA` → no consume cupo; rate-limit `consultaRateLimitPerMin`.
 *  - `TA` → rate-limit `taRateLimitPerMin`, NO cuenta para quota.
 *  - `NON_BILLABLE` o sin decorador → pasa.
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usageService: UsageService,
    private readonly rateLimiter: RateLimiterService,
    private readonly apiKeys: ApiKeysService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const billable = this.reflector.getAllAndOverride<BillableMetadata>(
      BILLABLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!billable || billable.kind === UsageKind.NON_BILLABLE) return true;

    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    // En el path de API key la org ya viene resuelta; desde el panel (JWT) la
    // resolvemos acá para que el endpoint cuente y respete el cupo igual.
    if (!req.organization && req.user?.organizationId) {
      req.organization =
        (await this.apiKeys.resolveOrganizationById(req.user.organizationId)) ?? undefined;
    }
    const org = req.organization;
    if (!org) {
      throw new UnauthorizedException(
        'Endpoint marcado como billable pero el request no tiene organización resuelta (falta @ApiKeyAuth?)',
      );
    }

    if (billable.kind === UsageKind.TA) {
      const keyId = req.apiKey?.id ?? org.id;
      await this.enforceRateLimit(`ta:${keyId}`, org.taRateLimitPerMin);
      return true;
    }
    if (billable.kind === UsageKind.CONSULTA) {
      await this.enforceRateLimit(`consulta:${org.id}`, org.consultaRateLimitPerMin);
      return true;
    }
    if (billable.kind === UsageKind.PDF) {
      await this.enforceRateLimit(`pdf:${org.id}`, org.pdfRateLimitPerMin);
    }

    const snapshot = await this.usageService.getCurrentSnapshot(org.id);
    const isPdf = billable.kind === UsageKind.PDF;
    const used = isPdf ? snapshot.pdfCount : snapshot.billableCount;
    // Los comprobantes de regalo (fallas nuestras, incidentes) amplían el cupo.
    const limit = isPdf ? org.pdfLimit : org.requestsLimit + snapshot.bonusCount;
    const overagePrice = isPdf ? org.pdfOveragePriceUsd : org.overagePriceUsd;
    const usedAfter = used + billable.cost;
    const allowsOverage = canChargeOverage(org, overagePrice);
    const hardLimit = allowsOverage
      ? Math.floor(limit * org.overageCapFactor)
      : Math.floor(limit * (isPdf ? 1 : org.graceFactor));

    if (usedAfter > hardLimit) {
      const unit = isPdf ? 'PDFs' : 'comprobantes';
      throw new HttpException(
        {
          error: isPdf ? 'pdf_quota_exceeded' : 'quota_exceeded',
          message: allowsOverage
            ? `Llegaste al techo de excedente de tu plan "${org.planSlug}" (${hardLimit} ${unit} en el ciclo). Subí de plan para seguir emitiendo antes del ${snapshot.periodEnd.toISOString()}.`
            : `Usaste los ${limit} ${unit} de tu plan "${org.planSlug}". Subí de plan para seguir emitiendo o esperá al próximo ciclo (${snapshot.periodEnd.toISOString()}).`,
          plan: org.planSlug,
          limit,
          hardLimit,
          used,
          overageAllowed: allowsOverage,
          periodEnd: snapshot.periodEnd,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (usedAfter > limit) {
      req._quotaWarning = allowsOverage ? 'overage' : 'grace';
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

/**
 * El excedente solo se habilita si el plan lo cobra y hay una suscripción
 * activa en MercadoPago contra la cual sumarlo al próximo débito.
 */
export function canChargeOverage(org: ResolvedOrganization, overagePriceUsd: number): boolean {
  return overagePriceUsd > 0 && org.subscriptionStatus === SubscriptionStatus.ACTIVE;
}
