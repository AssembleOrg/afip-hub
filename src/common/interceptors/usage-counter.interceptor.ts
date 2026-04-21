import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Reflector } from '@nestjs/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { BILLABLE_KEY, BillableMetadata } from '../decorators/billable.decorator';
import { SaasRequest } from '../types/request-context';
import { UsageKind } from '../../../generated/prisma';
import { UsageService } from '@/modules/usage/usage.service';
import { PrismaService } from '@/database/prisma.service';
import {
  EVENTS,
  QuotaExhausted100Payload,
  QuotaWarning80Payload,
} from '../events';

const WARNING_HEADER = 'X-Usage-Warning';

/**
 * Después de cada request billable:
 *  - Escribe UsageEvent + incrementa counter (fuente de verdad).
 *  - Agrega `X-Usage-Warning: grace` si QuotaGuard marcó que entró en gracia.
 *  - **Detecta cruces de umbral 80% / 100%** comparando `before` vs `after`
 *    del counter y emite el evento correspondiente solo una vez por
 *    transición. La dedupe real la hace NotificationsService con `dedupeKey`
 *    (basado en `periodStart`) — acá solo evitamos spam de eventos.
 */
@Injectable()
export class UsageCounterInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UsageCounterInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly usageService: UsageService,
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const billable = this.reflector.getAllAndOverride<BillableMetadata>(
      BILLABLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!billable || billable.kind === UsageKind.NON_BILLABLE) {
      return next.handle();
    }

    const http = ctx.switchToHttp();
    const req = http.getRequest<SaasRequest>();
    const res = http.getResponse();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        if (req._quotaWarning === 'grace') {
          res.setHeader(WARNING_HEADER, 'grace');
        }
        this.record(req, billable, res.statusCode ?? 200, Date.now() - startedAt);
      }),
      catchError((err) => {
        const status = err?.status ?? err?.getStatus?.() ?? 500;
        this.record(req, billable, status, Date.now() - startedAt);
        return throwError(() => err);
      }),
    );
  }

  private record(
    req: SaasRequest,
    billable: BillableMetadata,
    statusCode: number,
    durationMs: number,
  ) {
    const org = req.organization;
    if (!org) {
      this.logger.warn(
        `Endpoint billable sin org (${req.method} ${req.originalUrl}); status=${statusCode}`,
      );
      return;
    }

    const isBillable =
      billable.kind === UsageKind.BILLABLE || billable.kind === UsageKind.PDF;
    const wasSuccess = statusCode >= 200 && statusCode < 300;

    this.usageService
      .recordEvent({
        organizationId: org.id,
        apiKeyId: req.apiKey?.id ?? null,
        endpoint: req.route?.path ?? req.originalUrl?.split('?')[0] ?? req.url,
        method: req.method,
        kind: billable.kind,
        cost: billable.cost,
        statusCode,
        durationMs,
        ip: (req.ip || req.socket?.remoteAddress || '').toString(),
        userAgent:
          typeof req.headers['user-agent'] === 'string'
            ? (req.headers['user-agent'] as string)
            : null,
      })
      .then(() => {
        if (isBillable && wasSuccess) {
          void this.checkQuotaThresholds(org.id).catch((e) =>
            this.logger.error(`checkQuotaThresholds falló: ${String(e)}`),
          );
        }
      })
      .catch((e) =>
        this.logger.error(`Fallo recordEvent: ${String(e?.message ?? e)}`),
      );
  }

  /**
   * Post-increment: lee counter actualizado y emite evento si cruzamos 80%
   * o 100% del `requestsLimit` del plan. La dedupe por ciclo la hace el
   * subscriber vía `dedupeKey` en NotificationDelivery.
   */
  private async checkQuotaThresholds(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        plan: true,
        owner: { select: { email: true } },
      },
    });
    if (!org || !org.plan.requestsLimit) return;

    const snapshot = await this.usageService.getCurrentSnapshot(orgId);
    const used = snapshot.billableCount; // billableCount incluye PDFs (suma arriba)
    const limit = org.plan.requestsLimit;
    const graceLimit = Math.floor(limit * Number(org.plan.graceFactor));

    if (used >= limit) {
      const payload: QuotaExhausted100Payload = {
        organizationId: orgId,
        ownerEmail: org.owner.email,
        orgName: org.name,
        planSlug: org.plan.slug,
        used,
        limit,
        graceLimit,
        periodStart: org.currentPeriodStart,
        periodEnd: org.currentPeriodEnd,
      };
      this.events.emit(EVENTS.QUOTA_EXHAUSTED_100, payload);
      return;
    }

    const ratio = used / limit;
    if (ratio >= 0.8) {
      const payload: QuotaWarning80Payload = {
        organizationId: orgId,
        ownerEmail: org.owner.email,
        orgName: org.name,
        planSlug: org.plan.slug,
        used,
        limit,
        periodStart: org.currentPeriodStart,
        periodEnd: org.currentPeriodEnd,
      };
      this.events.emit(EVENTS.QUOTA_WARNING_80, payload);
    }
  }
}
