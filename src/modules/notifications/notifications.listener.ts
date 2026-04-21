import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '@/database/prisma.service';
import { EVENTS } from '@/common/events';
import type {
  BlueJumpedPayload,
  CertificateExpiringPayload,
  PaymentApprovedPayload,
  PaymentFailedPayload,
  QuotaExhausted100Payload,
  QuotaWarning80Payload,
  SubscriptionActivatedPayload,
  SubscriptionCanceledPayload,
} from '@/common/events';

// Umbrales de alerta en días. Cada cert dispara 1 email por cruce (60→30→15→7→3→1).
// Sincronizado con CertificateExpirationCron.WARNING_THRESHOLDS_DAYS.
const CERT_WARNING_THRESHOLDS = [60, 30, 15, 7, 3, 1];

/**
 * Suscribe al EventBus y traduce cada evento del sistema a un email concreto.
 * Dedupe/templating lo maneja NotificationsService. Si el email falla, queda
 * logged y FAILED en `NotificationDelivery`, nunca relanza.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent(EVENTS.QUOTA_WARNING_80, { async: true })
  async handleQuotaWarning80(p: QuotaWarning80Payload) {
    const plan = await this.getPlanName(p.planSlug);
    await this.notifications.sendQuotaWarning80({
      orgId: p.organizationId,
      ownerEmail: p.ownerEmail,
      orgName: p.orgName,
      planName: plan,
      used: p.used,
      limit: p.limit,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
    });
  }

  @OnEvent(EVENTS.QUOTA_EXHAUSTED_100, { async: true })
  async handleQuotaExhausted(p: QuotaExhausted100Payload) {
    const plan = await this.getPlanName(p.planSlug);
    await this.notifications.sendQuotaExhausted({
      orgId: p.organizationId,
      ownerEmail: p.ownerEmail,
      orgName: p.orgName,
      planName: plan,
      used: p.used,
      limit: p.limit,
      graceLimit: p.graceLimit,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
    });
  }

  @OnEvent(EVENTS.PAYMENT_FAILED, { async: true })
  async handlePaymentFailed(p: PaymentFailedPayload) {
    const plan = await this.getPlanName(p.planSlug);
    await this.notifications.sendPaymentFailed({
      orgId: p.organizationId,
      ownerEmail: p.ownerEmail,
      paymentId: p.paymentId,
      planName: plan,
      amountArs: p.amountArs,
      amountUsd: p.amountUsd,
      reason: p.reason,
      attemptedAt: p.attemptedAt,
    });
  }

  @OnEvent(EVENTS.PAYMENT_APPROVED, { async: true })
  async handlePaymentApproved(_p: PaymentApprovedPayload) {
    // No mandamos email en cada cobro aprobado — sería demasiado ruido. Solo
    // registramos el evento (es para webhooks y métricas). El email de
    // "bienvenida al plan" va con SUBSCRIPTION_ACTIVATED.
  }

  @OnEvent(EVENTS.SUBSCRIPTION_ACTIVATED, { async: true })
  async handleSubscriptionActivated(p: SubscriptionActivatedPayload) {
    await this.notifications.sendSubscriptionActivated({
      orgId: p.organizationId,
      ownerEmail: p.ownerEmail,
      orgName: p.orgName,
      planName: p.planName,
      requestsLimit: p.requestsLimit,
      cuitLimit: p.cuitLimit,
      pdfRateLimit: p.pdfRateLimit,
      amountArs: p.amountArs,
      amountUsd: p.amountUsd,
      exchangeRate: p.exchangeRate,
      nextBillingDate: p.nextBillingDate,
    });
  }

  @OnEvent(EVENTS.SUBSCRIPTION_CANCELED, { async: true })
  async handleSubscriptionCanceled(p: SubscriptionCanceledPayload) {
    await this.notifications.sendSubscriptionCanceled({
      orgId: p.organizationId,
      ownerEmail: p.ownerEmail,
      orgName: p.orgName,
      planName: p.planName,
      accessUntil: p.accessUntil,
    });
  }

  @OnEvent(EVENTS.BLUE_JUMPED, { async: true })
  async handleBlueJumped(p: BlueJumpedPayload) {
    await this.notifications.sendBlueJumped({
      orgId: p.organizationId,
      ownerEmail: p.ownerEmail,
      planName: p.planName,
      periodStart: p.periodStart,
      amountUsd: p.amountUsd,
      oldAmountArs: p.oldAmountArs,
      newAmountArs: p.newAmountArs,
      exchangeRate: p.exchangeRate,
      exchangeRateDate: p.exchangeRateDate,
      nextBillingDate: p.nextBillingDate,
      needsReauth: p.needsReauth,
    });
  }

  /**
   * Determina cuál es el mayor threshold que `daysUntilExpiry` cruzó. Así
   * si un cert vence en 5 días, matcheamos threshold=7 (ya cruzamos el 60,
   * 30, 15 en días anteriores y mandamos esos emails; ahora mandamos el 7).
   * El dedupeKey en el service evita reenviar el mismo threshold.
   */
  @OnEvent(EVENTS.CERTIFICATE_EXPIRING, { async: true })
  async handleCertExpiring(p: CertificateExpiringPayload) {
    // Owner email del org dueño del cert — buscamos porque el payload no lo trae.
    const org = await this.prisma.organization.findUnique({
      where: { id: p.organizationId },
      include: { owner: { select: { email: true } } },
    });
    if (!org?.owner) return;

    // Primer threshold >= daysUntilExpiry: si quedan 25 días, matchea 30.
    const threshold = CERT_WARNING_THRESHOLDS.find(
      (t) => p.daysUntilExpiry <= t,
    );
    if (!threshold) return;

    await this.notifications.sendCertificateExpiring({
      orgId: p.organizationId,
      ownerEmail: org.owner.email,
      certificateId: p.certificateId,
      cuit: p.cuit,
      alias: p.alias,
      notAfter: p.notAfter,
      daysUntilExpiry: p.daysUntilExpiry,
      threshold,
    });
  }

  private async getPlanName(slug: string): Promise<string> {
    const p = await this.prisma.plan.findUnique({ where: { slug } });
    return p?.name ?? slug;
  }
}
