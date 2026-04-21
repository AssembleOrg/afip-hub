import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/modules/email/email.service';
import { formatLocal } from '@/common/utils/clock';
import {
  NotificationKind,
  NotificationStatus,
  Prisma,
} from '../../../generated/prisma';

export interface NotifyParams<T extends Record<string, unknown> = Record<string, unknown>> {
  kind: NotificationKind;
  toEmail: string;
  organizationId?: string | null;
  userId?: string | null;
  /** Key de idempotencia: si ya existe, no se manda de nuevo. */
  dedupeKey?: string;
  subject: string;
  preheader: string;
  template: string;
  data: T;
}

/**
 * Centraliza el envío de emails de sistema con idempotencia y trazabilidad.
 *
 *  - `dedupeKey` (único en DB) garantiza 1-sola-vez por combinación lógica.
 *    Ej: `quota_warning_80:{orgId}:{periodStart}` no se repite en el ciclo.
 *  - Si no hay dedupeKey, se envía siempre.
 *  - Cada envío se registra en `NotificationDelivery` con status y error.
 *  - Nunca tira — si el email falla, queda `FAILED` en la tabla y la
 *    operación principal sigue.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async notify(params: NotifyParams): Promise<void> {
    const productName =
      this.config.get<string>('branding.productName') || 'AFIP Hub';

    // Dedupe preflight: si ya hay un registro para esta key, salimos.
    if (params.dedupeKey) {
      const existing = await this.prisma.notificationDelivery.findUnique({
        where: { dedupeKey: params.dedupeKey },
      });
      if (existing) {
        this.logger.debug(
          `Notification dedupe hit: kind=${params.kind} key=${params.dedupeKey}`,
        );
        return;
      }
    }

    let delivery;
    try {
      delivery = await this.prisma.notificationDelivery.create({
        data: {
          organizationId: params.organizationId ?? null,
          userId: params.userId ?? null,
          kind: params.kind,
          dedupeKey: params.dedupeKey ?? null,
          toEmail: params.toEmail,
          subject: params.subject,
          templateName: params.template,
          status: NotificationStatus.PENDING,
        },
      });
    } catch (err) {
      // Race: otro proceso con el mismo dedupeKey ganó. Está bien.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(`Race dedupe: ${params.dedupeKey} ya existía`);
        return;
      }
      throw err;
    }

    try {
      await this.email.sendTemplate({
        to: params.toEmail,
        template: params.template,
        subject: params.subject,
        preheader: params.preheader,
        data: {
          productName,
          generatedAt: formatLocal(new Date(), 'datetime'),
          ...params.data,
        },
      });
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: NotificationStatus.SENT, sentAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `Fallo enviando notification ${params.kind} a ${params.toEmail}: ${String(err)}`,
      );
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationStatus.FAILED,
          error: String((err as Error).message ?? err).slice(0, 1000),
        },
      });
      // No relanzamos — el caller no debe fallar por un email.
    }
  }

  /**
   * Helpers tipados para cada evento. Esto centraliza la construcción del
   * `dedupeKey` y los datos del template así los callers no los duplican.
   */

  async sendQuotaWarning80(params: {
    orgId: string;
    ownerEmail: string;
    orgName: string;
    planName: string;
    used: number;
    limit: number;
    periodStart: Date;
    periodEnd: Date;
  }) {
    const pct = Math.floor((params.used / params.limit) * 100);
    return this.notify({
      kind: NotificationKind.QUOTA_WARNING_80,
      organizationId: params.orgId,
      toEmail: params.ownerEmail,
      dedupeKey: `quota_warning_80:${params.orgId}:${params.periodStart.toISOString()}`,
      template: 'quota-warning',
      subject: `Usaste el ${pct}% de tu plan — ${params.planName}`,
      preheader: `Todavía te quedan ${params.limit - params.used} requests este ciclo`,
      data: {
        userName: params.orgName,
        orgName: params.orgName,
        planName: params.planName,
        used: params.used,
        limit: params.limit,
        percentUsed: pct,
        periodEnd: formatLocal(params.periodEnd, 'date'),
      },
    });
  }

  async sendQuotaExhausted(params: {
    orgId: string;
    ownerEmail: string;
    orgName: string;
    planName: string;
    used: number;
    limit: number;
    graceLimit: number;
    periodStart: Date;
    periodEnd: Date;
  }) {
    return this.notify({
      kind: NotificationKind.QUOTA_EXHAUSTED_100,
      organizationId: params.orgId,
      toEmail: params.ownerEmail,
      dedupeKey: `quota_exhausted_100:${params.orgId}:${params.periodStart.toISOString()}`,
      template: 'quota-exhausted',
      subject: `Llegaste al límite de tu plan ${params.planName}`,
      preheader: `Entraste en la zona de gracia del 2%`,
      data: {
        userName: params.orgName,
        orgName: params.orgName,
        planName: params.planName,
        used: params.used,
        limit: params.limit,
        graceLimit: params.graceLimit,
        periodEnd: formatLocal(params.periodEnd, 'datetime'),
      },
    });
  }

  async sendPaymentFailed(params: {
    orgId: string;
    ownerEmail: string;
    paymentId: string;
    planName: string;
    amountArs: number;
    amountUsd: number;
    reason: string;
    attemptedAt: Date;
  }) {
    return this.notify({
      kind: NotificationKind.PAYMENT_FAILED,
      organizationId: params.orgId,
      toEmail: params.ownerEmail,
      dedupeKey: `payment_failed:${params.paymentId}`,
      template: 'payment-failed',
      subject: `No pudimos cobrar tu suscripción (${params.planName})`,
      preheader: `MercadoPago rechazó el cobro. Actualizá tu medio de pago`,
      data: {
        userName: params.ownerEmail.split('@')[0],
        planName: params.planName,
        amountArs: params.amountArs.toFixed(2),
        amountUsd: params.amountUsd.toFixed(2),
        reason: params.reason || 'rechazado por el emisor',
        attemptedAt: formatLocal(params.attemptedAt, 'datetime'),
      },
    });
  }

  async sendSubscriptionActivated(params: {
    orgId: string;
    ownerEmail: string;
    orgName: string;
    planName: string;
    requestsLimit: number;
    cuitLimit: number;
    pdfRateLimit: number;
    amountArs: number;
    amountUsd: number;
    exchangeRate: number;
    nextBillingDate: Date;
  }) {
    return this.notify({
      kind: NotificationKind.SUBSCRIPTION_ACTIVATED,
      organizationId: params.orgId,
      toEmail: params.ownerEmail,
      // Sin dedupe — si alguien re-activa explícitamente, queremos notificar.
      template: 'subscription-activated',
      subject: `¡Estás en ${params.planName}!`,
      preheader: `Tu suscripción está activa, ya podés usar todo el plan`,
      data: {
        userName: params.ownerEmail.split('@')[0],
        orgName: params.orgName,
        planName: params.planName,
        requestsLimit: params.requestsLimit.toLocaleString('es-AR'),
        cuitLimit: params.cuitLimit,
        pdfRateLimit: params.pdfRateLimit,
        amountArs: params.amountArs.toFixed(2),
        amountUsd: params.amountUsd.toFixed(2),
        exchangeRate: params.exchangeRate.toFixed(2),
        nextBillingDate: formatLocal(params.nextBillingDate, 'date'),
      },
    });
  }

  async sendSubscriptionCanceled(params: {
    orgId: string;
    ownerEmail: string;
    orgName: string;
    planName: string;
    accessUntil: Date;
  }) {
    return this.notify({
      kind: NotificationKind.SUBSCRIPTION_CANCELED,
      organizationId: params.orgId,
      toEmail: params.ownerEmail,
      template: 'subscription-canceled',
      subject: `Suscripción cancelada — ${params.planName}`,
      preheader: `Podés seguir usando el plan hasta ${formatLocal(params.accessUntil, 'date')}`,
      data: {
        orgName: params.orgName,
        planName: params.planName,
        accessUntil: formatLocal(params.accessUntil, 'date'),
      },
    });
  }

  async sendBlueJumped(params: {
    orgId: string;
    ownerEmail: string;
    planName: string;
    periodStart: Date;
    amountUsd: number;
    oldAmountArs: number;
    newAmountArs: number;
    exchangeRate: number;
    exchangeRateDate: Date;
    nextBillingDate: Date;
    needsReauth: boolean;
  }) {
    const percentChange = (
      ((params.newAmountArs - params.oldAmountArs) / params.oldAmountArs) *
      100
    ).toFixed(1);
    return this.notify({
      kind: NotificationKind.BLUE_JUMPED,
      organizationId: params.orgId,
      toEmail: params.ownerEmail,
      dedupeKey: `blue_jumped:${params.orgId}:${params.periodStart.toISOString()}`,
      template: 'blue-jumped',
      subject: `Tu próximo cobro cambió (${percentChange}%)`,
      preheader: `El dólar blue se movió y actualizamos el monto ARS`,
      data: {
        userName: params.ownerEmail.split('@')[0],
        planName: params.planName,
        amountUsd: params.amountUsd.toFixed(2),
        oldAmountArs: params.oldAmountArs.toFixed(2),
        newAmountArs: params.newAmountArs.toFixed(2),
        exchangeRate: params.exchangeRate.toFixed(2),
        exchangeRateDate: formatLocal(params.exchangeRateDate, 'date'),
        percentChange,
        nextBillingDate: formatLocal(params.nextBillingDate, 'date'),
        needsReauth: params.needsReauth,
      },
    });
  }

  async sendCertificateExpiring(params: {
    orgId: string;
    ownerEmail: string;
    certificateId: string;
    cuit: string;
    alias: string;
    notAfter: Date;
    daysUntilExpiry: number;
    threshold: number;
  }) {
    const isCritical = params.daysUntilExpiry <= 7;
    const daySuffix = params.daysUntilExpiry === 1 ? '' : 's';
    const subject = isCritical
      ? `⚠ Tu certificado AFIP "${params.alias}" vence en ${params.daysUntilExpiry} día${daySuffix}`
      : `Tu certificado AFIP "${params.alias}" vence en ${params.daysUntilExpiry} días`;

    return this.notify({
      kind: NotificationKind.CERTIFICATE_EXPIRING,
      organizationId: params.orgId,
      toEmail: params.ownerEmail,
      // Dedupe por cert + threshold → 1 email por cruce de umbral (60/30/15/7/3/1)
      dedupeKey: `cert_expiring:${params.certificateId}:${params.threshold}`,
      template: 'certificate-expiring',
      subject,
      preheader: `Renová el cert (CUIT ${params.cuit}) antes del ${formatLocal(params.notAfter, 'date')}`,
      data: {
        alias: params.alias,
        cuit: params.cuit,
        daysUntilExpiry: params.daysUntilExpiry,
        isSingular: params.daysUntilExpiry === 1,
        isCritical,
        notAfterFormatted: formatLocal(params.notAfter, 'date'),
      },
    });
  }
}
