import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhooksService } from './webhooks.service';
import { EVENTS } from '@/common/events';
import type {
  BlueJumpedPayload,
  EventName,
  InvoiceEmittedPayload,
  PaymentApprovedPayload,
  PaymentFailedPayload,
  QuotaExhausted100Payload,
  QuotaWarning80Payload,
  ScheduledTaskResultPayload,
  SubscriptionActivatedPayload,
  SubscriptionCanceledPayload,
} from '@/common/events';

/**
 * Escucha cada evento del sistema y lo enqueuea como webhook delivery para
 * las suscripciones que están interesadas. La fanout real la hace
 * WebhooksService.enqueueEvent (1 delivery por suscripción matching).
 *
 * Cada handler redacta info sensible antes de enviar (ej: no mandamos
 * cert/key por webhook).
 */
@Injectable()
export class WebhooksListener {
  private readonly logger = new Logger(WebhooksListener.name);

  constructor(private readonly service: WebhooksService) {}

  @OnEvent(EVENTS.QUOTA_WARNING_80, { async: true })
  handleQuotaWarning(p: QuotaWarning80Payload) {
    return this.fanout(EVENTS.QUOTA_WARNING_80, p.organizationId, {
      orgId: p.organizationId,
      orgName: p.orgName,
      planSlug: p.planSlug,
      used: p.used,
      limit: p.limit,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
    });
  }

  @OnEvent(EVENTS.QUOTA_EXHAUSTED_100, { async: true })
  handleQuotaExhausted(p: QuotaExhausted100Payload) {
    return this.fanout(EVENTS.QUOTA_EXHAUSTED_100, p.organizationId, {
      orgId: p.organizationId,
      orgName: p.orgName,
      planSlug: p.planSlug,
      used: p.used,
      limit: p.limit,
      graceLimit: p.graceLimit,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
    });
  }

  @OnEvent(EVENTS.PAYMENT_APPROVED, { async: true })
  handlePaymentApproved(p: PaymentApprovedPayload) {
    return this.fanout(EVENTS.PAYMENT_APPROVED, p.organizationId, {
      orgId: p.organizationId,
      paymentId: p.paymentId,
      planSlug: p.planSlug,
      amountArs: p.amountArs,
      amountUsd: p.amountUsd,
      exchangeRate: p.exchangeRate,
    });
  }

  @OnEvent(EVENTS.PAYMENT_FAILED, { async: true })
  handlePaymentFailed(p: PaymentFailedPayload) {
    return this.fanout(EVENTS.PAYMENT_FAILED, p.organizationId, {
      orgId: p.organizationId,
      paymentId: p.paymentId,
      planSlug: p.planSlug,
      amountArs: p.amountArs,
      amountUsd: p.amountUsd,
      reason: p.reason,
      attemptedAt: p.attemptedAt.toISOString(),
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION_ACTIVATED, { async: true })
  handleSubscriptionActivated(p: SubscriptionActivatedPayload) {
    return this.fanout(EVENTS.SUBSCRIPTION_ACTIVATED, p.organizationId, {
      orgId: p.organizationId,
      planSlug: p.planSlug,
      planName: p.planName,
      nextBillingDate: p.nextBillingDate.toISOString(),
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION_CANCELED, { async: true })
  handleSubscriptionCanceled(p: SubscriptionCanceledPayload) {
    return this.fanout(EVENTS.SUBSCRIPTION_CANCELED, p.organizationId, {
      orgId: p.organizationId,
      planSlug: p.planSlug,
      planName: p.planName,
      accessUntil: p.accessUntil.toISOString(),
    });
  }

  @OnEvent(EVENTS.BLUE_JUMPED, { async: true })
  handleBlueJumped(p: BlueJumpedPayload) {
    return this.fanout(EVENTS.BLUE_JUMPED, p.organizationId, {
      orgId: p.organizationId,
      planSlug: p.planSlug,
      amountUsd: p.amountUsd,
      oldAmountArs: p.oldAmountArs,
      newAmountArs: p.newAmountArs,
      exchangeRate: p.exchangeRate,
      nextBillingDate: p.nextBillingDate.toISOString(),
      needsReauth: p.needsReauth,
    });
  }

  @OnEvent(EVENTS.INVOICE_EMITTED, { async: true })
  handleInvoiceEmitted(p: InvoiceEmittedPayload) {
    return this.fanout(EVENTS.INVOICE_EMITTED, p.organizationId, {
      orgId: p.organizationId,
      invoiceId: p.invoiceId,
      cuitEmisor: p.cuitEmisor,
      puntoVenta: p.puntoVenta,
      tipoComprobante: p.tipoComprobante,
      numeroComprobante: p.numeroComprobante,
      cae: p.cae,
      importeTotal: p.importeTotal,
      fechaComprobante: p.fechaComprobante,
      homologacion: p.homologacion,
    });
  }

  @OnEvent(EVENTS.SCHEDULED_TASK_SUCCEEDED, { async: true })
  handleTaskOk(p: ScheduledTaskResultPayload) {
    return this.fanout(EVENTS.SCHEDULED_TASK_SUCCEEDED, p.organizationId, p as unknown as Record<string, unknown>);
  }

  @OnEvent(EVENTS.SCHEDULED_TASK_FAILED, { async: true })
  handleTaskFail(p: ScheduledTaskResultPayload) {
    return this.fanout(EVENTS.SCHEDULED_TASK_FAILED, p.organizationId, p as unknown as Record<string, unknown>);
  }

  private async fanout(
    eventType: EventName,
    organizationId: string,
    payload: Record<string, unknown>,
  ) {
    try {
      const n = await this.service.enqueueEvent({
        organizationId,
        eventType,
        payload,
      });
      if (n > 0) {
        this.logger.debug(`Fanout ${eventType} → ${n} delivery(ies) encoladas`);
      }
    } catch (err) {
      this.logger.error(
        `Fanout de ${eventType} (org=${organizationId}) falló: ${String(err)}`,
      );
    }
  }
}
