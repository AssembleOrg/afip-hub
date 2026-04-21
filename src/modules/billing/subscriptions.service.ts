import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@/database/prisma.service';
import { ExchangeRateService } from '@/modules/exchange-rate/exchange-rate.service';
import { PlansService } from '@/modules/plans/plans.service';
import { UsageService } from '@/modules/usage/usage.service';
import { AuditService } from '@/modules/audit/audit.service';
import { MercadoPagoService, MpPaymentData, MpPreapprovalData } from './mercadopago.service';
import { addMonths } from '@/common/utils/date.util';
import {
  BlueJumpedPayload,
  EVENTS,
  PaymentApprovedPayload,
  PaymentFailedPayload,
  SubscriptionActivatedPayload,
  SubscriptionCanceledPayload,
} from '@/common/events';
import {
  AuditActor,
  PaymentStatus,
  SubscriptionStatus,
} from '../../../generated/prisma';

function mapMpPreapprovalStatus(mp: string): SubscriptionStatus {
  switch (mp) {
    case 'authorized':
      return SubscriptionStatus.ACTIVE;
    case 'paused':
      return SubscriptionStatus.PAUSED;
    case 'cancelled':
    case 'finished':
      return SubscriptionStatus.CANCELED;
    case 'pending':
    default:
      return SubscriptionStatus.TRIALING;
  }
}

function mapMpPaymentStatus(mp: string): PaymentStatus {
  switch (mp) {
    case 'approved':
      return PaymentStatus.APPROVED;
    case 'rejected':
      return PaymentStatus.REJECTED;
    case 'refunded':
      return PaymentStatus.REFUNDED;
    case 'cancelled':
      return PaymentStatus.CANCELED;
    case 'pending':
    case 'in_process':
    default:
      return PaymentStatus.PENDING;
  }
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly mp: MercadoPagoService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Paso 1 del checkout: el owner elige un plan pago y nosotros creamos el
   * preapproval en MP. Devolvemos `init_point` para redirigirlo a la página de
   * MP donde autoriza el cobro.
   */
  async subscribe(params: {
    organizationId: string;
    payerEmail: string;
    planSlug: string;
    backUrl?: string;
    actorUserId?: string;
  }) {
    const plan = await this.plans.getBySlug(params.planSlug);
    if (Number(plan.priceUsd) <= 0) {
      throw new BadRequestException(
        `El plan "${plan.slug}" es gratuito, no requiere suscripción de pago`,
      );
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: params.organizationId },
    });
    if (!org) throw new NotFoundException('Organización no existe');

    // Si ya tiene una suscripción activa, la cancelamos primero (upgrade).
    if (org.mpPreapprovalId) {
      try {
        await this.mp.cancel(org.mpPreapprovalId);
      } catch (err) {
        this.logger.warn(
          `No se pudo cancelar preapproval previo ${org.mpPreapprovalId}: ${String(err)}`,
        );
      }
    }

    const sellRate = await this.exchangeRate.getSellRate();
    const amountArs = Number(plan.priceUsd) * sellRate;

    const preapproval = await this.mp.createPreapproval({
      payerEmail: params.payerEmail,
      reason: `afip-hub ${plan.name} (${org.slug})`,
      amountArs,
      externalReference: org.id,
      backUrl: params.backUrl,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: org.id },
        data: {
          planId: plan.id,
          mpPreapprovalId: preapproval.id,
          subscriptionStatus: mapMpPreapprovalStatus(preapproval.status),
        },
      });

      await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: plan.id,
          mpPreapprovalId: preapproval.id,
          status: mapMpPreapprovalStatus(preapproval.status),
          startedAt: new Date(),
          lastAmountArs: amountArs,
          lastAmountUsd: Number(plan.priceUsd),
          lastExchangeRate: sellRate,
          raw: preapproval as any,
        },
      });
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: params.actorUserId ?? null,
      organizationId: org.id,
      action: 'billing.subscription_created',
      severity: 'warn',
      targetType: 'subscription',
      targetId: preapproval.id,
      metadata: {
        planSlug: plan.slug,
        amountUsd: Number(plan.priceUsd),
        amountArs: Math.round(amountArs * 100) / 100,
        exchangeRate: sellRate,
      },
    });

    return {
      preapprovalId: preapproval.id,
      initPoint: preapproval.init_point,
      status: preapproval.status,
      amountArs: Math.round(amountArs * 100) / 100,
      amountUsd: Number(plan.priceUsd),
      exchangeRate: sellRate,
    };
  }

  /** Refresca el estado de la suscripción desde MP (útil al volver del back_url). */
  async refreshFromMp(preapprovalId: string) {
    const mpData = await this.mp.getPreapproval(preapprovalId);
    await this.applyPreapprovalUpdate(mpData);
    return mpData;
  }

  async cancel(organizationId: string, actorUserId?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organización no existe');
    if (!org.mpPreapprovalId) {
      throw new BadRequestException('La organización no tiene suscripción MP');
    }

    await this.mp.cancel(org.mpPreapprovalId);

    await this.prisma.$transaction(async (tx) => {
      const free = await this.plans.getDefault();
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          subscriptionStatus: SubscriptionStatus.CANCELED,
          // Al cancelar, volvemos al plan gratuito en el próximo ciclo.
          planId: free.id,
          mpPreapprovalId: null,
        },
      });
      await tx.subscription.updateMany({
        where: { organizationId, mpPreapprovalId: org.mpPreapprovalId! },
        data: {
          status: SubscriptionStatus.CANCELED,
          endedAt: new Date(),
        },
      });
    });

    void this.audit.record({
      actorType: actorUserId ? AuditActor.USER : AuditActor.SYSTEM,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: 'billing.subscription_canceled',
      severity: 'warn',
      targetType: 'subscription',
      targetId: org.mpPreapprovalId,
    });

    const orgFull = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true, owner: { select: { email: true } } },
    });
    if (orgFull?.owner) {
      const payload: SubscriptionCanceledPayload = {
        organizationId,
        ownerEmail: orgFull.owner.email,
        orgName: orgFull.name,
        planSlug: orgFull.plan.slug,
        planName: orgFull.plan.name,
        accessUntil: orgFull.currentPeriodEnd,
      };
      this.events.emit(EVENTS.SUBSCRIPTION_CANCELED, payload);
    }
  }

  /** Handler del webhook cuando llega una notificación tipo `preapproval`. */
  async applyPreapprovalUpdate(mp: MpPreapprovalData) {
    const sub = await this.prisma.subscription.findFirst({
      where: { mpPreapprovalId: mp.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) {
      this.logger.warn(`Webhook preapproval ${mp.id} sin subscription local`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: mapMpPreapprovalStatus(mp.status),
          raw: mp as any,
        },
      });
      await tx.organization.update({
        where: { id: sub.organizationId },
        data: { subscriptionStatus: mapMpPreapprovalStatus(mp.status) },
      });
    });
  }

  /**
   * Handler del webhook cuando llega una notificación tipo `payment`. Si el
   * pago está aprobado, lo registramos, avanzamos el período de la org y
   * reseteamos el counter.
   */
  async applyPaymentUpdate(payment: MpPaymentData) {
    const preapprovalId = payment.preapproval_id;
    if (!preapprovalId) {
      this.logger.debug(
        `Payment ${payment.id} sin preapproval_id — ignorado (no es pago recurrente)`,
      );
      return;
    }

    const sub = await this.prisma.subscription.findFirst({
      where: { mpPreapprovalId: preapprovalId },
      orderBy: { createdAt: 'desc' },
      include: { organization: true },
    });
    if (!sub) {
      this.logger.warn(`Payment para preapproval ${preapprovalId} sin subscription local`);
      return;
    }

    const status = mapMpPaymentStatus(payment.status);
    const sellRate = sub.lastExchangeRate
      ? Number(sub.lastExchangeRate)
      : await this.exchangeRate.getSellRate();
    const amountUsd = Number(sub.lastAmountUsd ?? 0) || 0;

    const existing = await this.prisma.payment.findUnique({
      where: { mpPaymentId: String(payment.id) },
    });
    if (existing) {
      await this.prisma.payment.update({
        where: { id: existing.id },
        data: {
          status,
          paidAt: payment.date_approved ? new Date(payment.date_approved) : null,
          raw: payment as any,
        },
      });
    } else {
      await this.prisma.payment.create({
        data: {
          subscriptionId: sub.id,
          mpPaymentId: String(payment.id),
          amountArs: payment.transaction_amount,
          amountUsd,
          exchangeRate: sellRate,
          status,
          periodStart: sub.organization.currentPeriodStart,
          periodEnd: sub.organization.currentPeriodEnd,
          paidAt: payment.date_approved ? new Date(payment.date_approved) : null,
          failureReason:
            status === PaymentStatus.REJECTED ? payment.status_detail : null,
          raw: payment as any,
        },
      });
    }

    if (status === PaymentStatus.APPROVED) {
      // Pago exitoso → avanzamos el período y reseteamos counter.
      await this.usage.rollToNextPeriod(sub.organizationId);
      await this.prisma.organization.update({
        where: { id: sub.organizationId },
        data: { subscriptionStatus: SubscriptionStatus.ACTIVE },
      });
      this.logger.log(
        `Pago ${payment.id} aprobado para org ${sub.organizationId}, período avanzado`,
      );
      void this.audit.record({
        actorType: AuditActor.SYSTEM,
        organizationId: sub.organizationId,
        action: 'billing.payment_approved',
        targetType: 'payment',
        targetId: String(payment.id),
        metadata: {
          amountArs: payment.transaction_amount,
          amountUsd,
          preapprovalId,
        },
      });

      // Eventos: primer pago aprobado → también SUBSCRIPTION_ACTIVATED.
      const wasFirstPayment = !sub.organization.currentPeriodEnd ||
        sub.organization.subscriptionStatus !== SubscriptionStatus.ACTIVE;
      const org = await this.prisma.organization.findUnique({
        where: { id: sub.organizationId },
        include: { plan: true, owner: { select: { email: true } } },
      });
      if (org?.owner) {
        const paymentPayload: PaymentApprovedPayload = {
          organizationId: sub.organizationId,
          ownerEmail: org.owner.email,
          paymentId: String(payment.id),
          amountArs: payment.transaction_amount,
          amountUsd,
          exchangeRate: sellRate,
          planSlug: org.plan.slug,
        };
        this.events.emit(EVENTS.PAYMENT_APPROVED, paymentPayload);

        if (wasFirstPayment) {
          const actPayload: SubscriptionActivatedPayload = {
            organizationId: sub.organizationId,
            ownerEmail: org.owner.email,
            orgName: org.name,
            planSlug: org.plan.slug,
            planName: org.plan.name,
            requestsLimit: org.plan.requestsLimit,
            cuitLimit: org.plan.cuitLimit,
            pdfRateLimit: org.plan.pdfRateLimitPerMin,
            amountArs: payment.transaction_amount,
            amountUsd,
            exchangeRate: sellRate,
            nextBillingDate: org.currentPeriodEnd,
          };
          this.events.emit(EVENTS.SUBSCRIPTION_ACTIVATED, actPayload);
        }
      }
    } else if (status === PaymentStatus.REJECTED) {
      await this.prisma.organization.update({
        where: { id: sub.organizationId },
        data: { subscriptionStatus: SubscriptionStatus.PAST_DUE },
      });
      this.logger.warn(
        `Pago ${payment.id} rechazado para org ${sub.organizationId} → PAST_DUE`,
      );
      void this.audit.record({
        actorType: AuditActor.SYSTEM,
        organizationId: sub.organizationId,
        action: 'billing.payment_failed',
        severity: 'error',
        targetType: 'payment',
        targetId: String(payment.id),
        metadata: {
          amountArs: payment.transaction_amount,
          reason: payment.status_detail,
          preapprovalId,
        },
      });

      const org = await this.prisma.organization.findUnique({
        where: { id: sub.organizationId },
        include: { plan: true, owner: { select: { email: true } } },
      });
      if (org?.owner) {
        const failedPayload: PaymentFailedPayload = {
          organizationId: sub.organizationId,
          ownerEmail: org.owner.email,
          paymentId: String(payment.id),
          amountArs: payment.transaction_amount,
          amountUsd,
          planSlug: org.plan.slug,
          reason: payment.status_detail ?? 'rechazado',
          attemptedAt: payment.date_created ? new Date(payment.date_created) : new Date(),
        };
        this.events.emit(EVENTS.PAYMENT_FAILED, failedPayload);
      }
    }
  }

  /**
   * Antes de cada ciclo mensual, actualizamos el `transaction_amount` del
   * preapproval con el dólar blue actual. Si la diferencia es >20%, MP puede
   * requerir re-consentimiento; marcamos la suscripción como PAUSED y dejamos
   * que el webhook la reactive cuando el usuario re-autorice.
   */
  async recalcUpcomingAmount(organizationId: string): Promise<{
    updated: boolean;
    newAmountArs?: number;
    reason?: string;
  }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });
    if (!org || !org.mpPreapprovalId) {
      return { updated: false, reason: 'sin_preapproval' };
    }

    const sub = await this.prisma.subscription.findFirst({
      where: { mpPreapprovalId: org.mpPreapprovalId },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return { updated: false, reason: 'sin_subscription' };

    const sellRate = await this.exchangeRate.getSellRate();
    const newAmountArs = Number(org.plan.priceUsd) * sellRate;
    const lastAmount = Number(sub.lastAmountArs ?? 0);

    // Si cambia menos de $1, no molestamos a MP.
    if (Math.abs(newAmountArs - lastAmount) < 1) {
      return { updated: false, reason: 'sin_cambio' };
    }

    await this.mp.updateAmount(org.mpPreapprovalId, newAmountArs);
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        lastAmountArs: newAmountArs,
        lastAmountUsd: Number(org.plan.priceUsd),
        lastExchangeRate: sellRate,
      },
    });

    // Evento de blue-jumped si el cambio supera threshold (10% default) —
    // esto avisa al cliente antes del cobro y flaggea re-auth si >20%.
    const pctChange = lastAmount > 0
      ? Math.abs(newAmountArs - lastAmount) / lastAmount
      : 0;
    if (pctChange >= 0.1) {
      const owner = await this.prisma.user.findUnique({
        where: { id: org.ownerUserId },
        select: { email: true },
      });
      if (owner) {
        const payload: BlueJumpedPayload = {
          organizationId,
          ownerEmail: owner.email,
          planSlug: org.plan.slug,
          planName: org.plan.name,
          periodStart: org.currentPeriodStart,
          amountUsd: Number(org.plan.priceUsd),
          oldAmountArs: lastAmount,
          newAmountArs,
          exchangeRate: sellRate,
          exchangeRateDate: new Date(),
          nextBillingDate: org.currentPeriodEnd,
          needsReauth: pctChange >= 0.2,
        };
        this.events.emit(EVENTS.BLUE_JUMPED, payload);
      }
    }

    return { updated: true, newAmountArs };
  }

  /** Resumen completo de facturación para el dashboard del usuario. */
  async getSummary(organizationId: string) {
    const [sub, org, blueRate] = await Promise.all([
      this.prisma.subscription.findFirst({
        where: { organizationId, status: { not: 'CANCELED' } },
        orderBy: { createdAt: 'desc' },
        include: {
          plan: true,
          payments: { orderBy: { createdAt: 'desc' }, take: 12 },
        },
      }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        include: { plan: true },
      }),
      this.exchangeRate.getSellRate().catch(() => 0),
    ]);

    const plan = org?.plan ?? null;
    const priceArsEstimate = plan
      ? Math.round(Number(plan.priceUsd) * blueRate)
      : 0;

    const payments = (sub?.payments ?? []).map((p) => {
      const d = p.periodStart ?? p.createdAt;
      const concept = `${sub?.plan?.name ?? plan?.name ?? 'Plan'} · ${new Date(d).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}`;
      return {
        id: p.id,
        mpPaymentId: p.mpPaymentId ?? '',
        amountArs: Number(p.amountArs),
        amountUsd: Number(p.amountUsd),
        status: p.status as string,
        paidAt: p.paidAt?.toISOString() ?? null,
        concept,
        createdAt: p.createdAt.toISOString(),
      };
    });

    return {
      subscription: sub
        ? {
            id: sub.id,
            planSlug: sub.plan.slug,
            planName: sub.plan.name,
            status: sub.status as string,
            startedAt: sub.startedAt.toISOString(),
            endedAt: sub.endedAt?.toISOString() ?? null,
            lastAmountArs: sub.lastAmountArs ? Number(sub.lastAmountArs) : null,
            lastAmountUsd: sub.lastAmountUsd ? Number(sub.lastAmountUsd) : null,
            lastExchangeRate: sub.lastExchangeRate
              ? Number(sub.lastExchangeRate)
              : null,
            currentPeriodStart:
              org?.currentPeriodStart?.toISOString() ??
              sub.startedAt.toISOString(),
            currentPeriodEnd:
              org?.currentPeriodEnd?.toISOString() ?? '',
            mpPreapprovalId: sub.mpPreapprovalId ?? null,
            mpInitPoint: null,
          }
        : null,
      payments,
      currentPlan: plan
        ? {
            slug: plan.slug,
            name: plan.name,
            priceUsd: Number(plan.priceUsd),
            priceArsEstimate,
            requestsLimit: plan.requestsLimit,
            cuitLimit: plan.cuitLimit,
          }
        : null,
      nextChargeAt: org?.currentPeriodEnd?.toISOString() ?? null,
      blueRate,
    };
  }
}
