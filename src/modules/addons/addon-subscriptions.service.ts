import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { ExchangeRateService } from '@/modules/exchange-rate/exchange-rate.service';
import { AuditService } from '@/modules/audit/audit.service';
import {
  MercadoPagoService,
  MpPaymentData,
  MpPreapprovalData,
} from '@/modules/billing/mercadopago.service';
import { AddOnsService } from './addons.service';
import {
  AuditActor,
  BillingPeriod,
  PaymentStatus,
  SubscriptionStatus,
} from '../../../generated/prisma';
import { SubscribeAddOnDto } from './dto';

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
export class AddOnSubscriptionsService {
  private readonly logger = new Logger(AddOnSubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addons: AddOnsService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly mp: MercadoPagoService,
    private readonly audit: AuditService,
  ) {}

  /** Lista los addons activos de una org (con datos del AddOn). */
  listForOrg(organizationId: string) {
    return this.prisma.orgAddOnSubscription.findMany({
      where: { organizationId, endedAt: null },
      include: { addon: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Contrata un addon. Dos flujos según `alignWithMainCycle`:
   *
   *  - **Alineado (default, si hay plan pago):** prorratea el monto según días
   *    que quedan del ciclo principal, cobra eso con un Payment one-time
   *    (MP Preference) y crea un Preapproval recurrente con
   *    `start_date=mainCycleEnd`. Resultado: desde el próximo ciclo, plan y
   *    addon se cobran el mismo día.
   *  - **Inmediato:** si plan free o `alignWithMainCycle=false`, crea un
   *    Preapproval que cobra hoy y cicla cada 30d/anualmente por su cuenta.
   *
   * Importante: en el flujo alineado el usuario autoriza **dos veces** en MP
   * (una para el Payment prorrateado, otra para el Preapproval futuro). Es una
   * limitación de MP — Payment y Preapproval son productos distintos.
   */
  async subscribe(params: {
    organizationId: string;
    payerEmail: string;
    dto: SubscribeAddOnDto;
    actorUserId?: string;
  }) {
    const addon = await this.addons.getBySlug(params.dto.addonSlug);
    if (!addon.isActive) {
      throw new BadRequestException(`El addon "${addon.slug}" no está activo`);
    }

    const billingPeriod = params.dto.billingPeriod ?? BillingPeriod.MONTHLY;
    const usdAmount =
      billingPeriod === BillingPeriod.ANNUAL
        ? Number(addon.annualPriceUsd)
        : Number(addon.priceUsd);

    if (usdAmount <= 0) {
      throw new BadRequestException(
        `El addon "${addon.slug}" no tiene precio configurado para ${billingPeriod}`,
      );
    }

    const existing = await this.prisma.orgAddOnSubscription.findUnique({
      where: {
        organizationId_addonId: {
          organizationId: params.organizationId,
          addonId: addon.id,
        },
      },
    });
    if (existing && existing.status !== SubscriptionStatus.CANCELED) {
      throw new BadRequestException(
        `Ya tenés el addon "${addon.slug}" suscripto (status=${existing.status})`,
      );
    }
    if (existing?.mpPreapprovalId) {
      try {
        await this.mp.cancel(existing.mpPreapprovalId);
      } catch (err) {
        this.logger.warn(
          `No pude cancelar preapproval previo ${existing.mpPreapprovalId}: ${String(err)}`,
        );
      }
    }

    const sellRate = await this.exchangeRate.getSellRate();
    const fullAmountArs = usdAmount * sellRate;

    // Resolver si alineamos ciclos. Requiere plan pago con currentPeriodEnd futuro.
    const wantsAlign = params.dto.alignWithMainCycle ?? true;
    const org = await this.prisma.organization.findUnique({
      where: { id: params.organizationId },
      include: { plan: true },
    });
    const mainCycleEnd = org?.currentPeriodEnd ?? null;
    const isPaidMainPlan = org && Number(org.plan.priceUsd) > 0;
    const canAlign =
      wantsAlign &&
      isPaidMainPlan &&
      mainCycleEnd !== null &&
      mainCycleEnd.getTime() > Date.now() + 2 * 86400_000; // al menos 2 días futuros

    if (canAlign) {
      return this.subscribeAligned({
        addon,
        org: org!,
        payerEmail: params.payerEmail,
        actorUserId: params.actorUserId,
        billingPeriod,
        usdAmount,
        fullAmountArs,
        sellRate,
        mainCycleEnd: mainCycleEnd!,
        backUrl: params.dto.backUrl,
        allowProration: addon.allowProration,
      });
    }

    return this.subscribeImmediate({
      addon,
      organizationId: params.organizationId,
      payerEmail: params.payerEmail,
      actorUserId: params.actorUserId,
      billingPeriod,
      usdAmount,
      amountArs: fullAmountArs,
      sellRate,
      backUrl: params.dto.backUrl,
    });
  }

  /** Flujo simple: preapproval inmediato que cicla independiente. */
  private async subscribeImmediate(p: {
    addon: { id: string; slug: string; name: string };
    organizationId: string;
    payerEmail: string;
    actorUserId?: string;
    billingPeriod: BillingPeriod;
    usdAmount: number;
    amountArs: number;
    sellRate: number;
    backUrl?: string;
  }) {
    const preapproval = await this.mp.createPreapproval({
      payerEmail: p.payerEmail,
      reason: `afip-hub addon ${p.addon.name}`,
      amountArs: p.amountArs,
      externalReference: `addon:${p.organizationId}:${p.addon.id}`,
      backUrl: p.backUrl,
    });

    const sub = await this.prisma.orgAddOnSubscription.upsert({
      where: {
        organizationId_addonId: {
          organizationId: p.organizationId,
          addonId: p.addon.id,
        },
      },
      create: {
        organizationId: p.organizationId,
        addonId: p.addon.id,
        mpPreapprovalId: preapproval.id,
        status: mapMpPreapprovalStatus(preapproval.status),
        billingPeriod: p.billingPeriod,
        startedAt: new Date(),
        lastAmountArs: p.amountArs,
        lastAmountUsd: p.usdAmount,
        lastExchangeRate: p.sellRate,
        raw: preapproval as any,
      },
      update: {
        mpPreapprovalId: preapproval.id,
        status: mapMpPreapprovalStatus(preapproval.status),
        billingPeriod: p.billingPeriod,
        startedAt: new Date(),
        endedAt: null,
        lastAmountArs: p.amountArs,
        lastAmountUsd: p.usdAmount,
        lastExchangeRate: p.sellRate,
        raw: preapproval as any,
      },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: p.actorUserId ?? null,
      organizationId: p.organizationId,
      action: 'addon.subscription_created',
      severity: 'warn',
      targetType: 'addon_subscription',
      targetId: sub.id,
      metadata: { addonSlug: p.addon.slug, mode: 'immediate' },
    });

    return {
      mode: 'immediate' as const,
      subscriptionId: sub.id,
      preapprovalId: preapproval.id,
      initPoint: preapproval.init_point,
      status: preapproval.status,
      addonSlug: p.addon.slug,
      amountArs: Math.round(p.amountArs * 100) / 100,
      amountUsd: p.usdAmount,
      exchangeRate: p.sellRate,
      billingPeriod: p.billingPeriod,
    };
  }

  /**
   * Flujo alineado: Payment one-time prorrateado + Preapproval diferido.
   * El frontend muestra primero `oneShotInitPoint` (cobra prorrateo ahora) y
   * después `preapprovalInitPoint` (autoriza el recurrente futuro).
   */
  private async subscribeAligned(p: {
    addon: { id: string; slug: string; name: string };
    org: { id: string; currentPeriodEnd: Date | null; currentPeriodStart: Date | null };
    payerEmail: string;
    actorUserId?: string;
    billingPeriod: BillingPeriod;
    usdAmount: number;
    fullAmountArs: number;
    sellRate: number;
    mainCycleEnd: Date;
    backUrl?: string;
    allowProration: boolean;
  }) {
    const now = new Date();
    const cycleStart =
      p.org.currentPeriodStart ?? new Date(p.mainCycleEnd.getTime() - 30 * 86400_000);
    const totalDays = Math.max(
      1,
      Math.round((p.mainCycleEnd.getTime() - cycleStart.getTime()) / 86400_000),
    );
    const daysRemaining = Math.max(
      1,
      Math.round((p.mainCycleEnd.getTime() - now.getTime()) / 86400_000),
    );
    const rawProrationFactor = Math.min(1, daysRemaining / totalDays);

    // Si el addon NO admite prorrateo, cobramos precio completo aunque sea
    // mid-cycle. Si admite, aplicamos proración con redondeo hacia ARRIBA a 1
    // decimal (anti-abuso: si se subscribe y cancela inmediato, igual paga un
    // poco más del estricto).
    const prorationFactor = p.allowProration ? rawProrationFactor : 1;
    const rawProratedUsd = p.usdAmount * prorationFactor;
    const proratedUsd = p.allowProration
      ? this.ceilOneDecimal(rawProratedUsd)
      : p.usdAmount;
    const proratedArs = proratedUsd * p.sellRate;

    // 1) Creamos la subscription localmente (pending) para obtener ID y usarlo
    //    como external_reference del Preference y Preapproval.
    const sub = await this.prisma.orgAddOnSubscription.upsert({
      where: {
        organizationId_addonId: { organizationId: p.org.id, addonId: p.addon.id },
      },
      create: {
        organizationId: p.org.id,
        addonId: p.addon.id,
        status: SubscriptionStatus.TRIALING,
        billingPeriod: p.billingPeriod,
        startedAt: now,
        lastAmountArs: p.fullAmountArs,
        lastAmountUsd: p.usdAmount,
        lastExchangeRate: p.sellRate,
      },
      update: {
        status: SubscriptionStatus.TRIALING,
        billingPeriod: p.billingPeriod,
        startedAt: now,
        endedAt: null,
        lastAmountArs: p.fullAmountArs,
        lastAmountUsd: p.usdAmount,
        lastExchangeRate: p.sellRate,
      },
    });

    // 2) Preference (Payment one-time) con el monto prorrateado.
    const preference = await this.mp.createPreference({
      title: `afip-hub addon ${p.addon.name} (ciclo parcial)`,
      amountArs: proratedArs,
      externalReference: `addon_oneshot:${sub.id}`,
      payerEmail: p.payerEmail,
      backUrl: p.backUrl,
    });

    // 3) Preapproval recurrente con start_date = mainCycleEnd (alineado).
    const preapproval = await this.mp.createPreapproval({
      payerEmail: p.payerEmail,
      reason: `afip-hub addon ${p.addon.name}`,
      amountArs: p.fullAmountArs,
      externalReference: `addon:${p.org.id}:${p.addon.id}`,
      backUrl: p.backUrl,
      startDate: p.mainCycleEnd,
    });

    // 4) Persistimos preapprovalId + un AddOnPayment PENDING del one-shot.
    await this.prisma.$transaction([
      this.prisma.orgAddOnSubscription.update({
        where: { id: sub.id },
        data: {
          mpPreapprovalId: preapproval.id,
          status: mapMpPreapprovalStatus(preapproval.status),
          raw: { preference, preapproval } as any,
        },
      }),
      this.prisma.addOnPayment.create({
        data: {
          subscriptionId: sub.id,
          // mpPaymentId se completa cuando llegue el webhook del payment one-shot.
          mpPaymentId: null,
          amountArs: proratedArs,
          amountUsd: proratedUsd,
          exchangeRate: p.sellRate,
          status: 'PENDING',
          periodStart: now,
          periodEnd: p.mainCycleEnd,
          raw: { kind: 'oneshot', preferenceId: preference.id } as any,
        },
      }),
    ]);

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: p.actorUserId ?? null,
      organizationId: p.org.id,
      action: 'addon.subscription_created',
      severity: 'warn',
      targetType: 'addon_subscription',
      targetId: sub.id,
      metadata: {
        addonSlug: p.addon.slug,
        mode: 'aligned',
        prorationAllowed: p.allowProration,
        rawProrationFactor: Math.round(rawProrationFactor * 10000) / 10000,
        effectiveProrationFactor: Math.round(prorationFactor * 10000) / 10000,
        proratedAmountUsd: proratedUsd,
        proratedAmountArs: Math.round(proratedArs * 100) / 100,
        nextChargeAt: p.mainCycleEnd,
      },
    });

    return {
      mode: 'aligned' as const,
      subscriptionId: sub.id,
      preapprovalId: preapproval.id,
      /** Paso 1: el frontend abre esto para cobrar el prorrateo one-time. */
      oneShotInitPoint: preference.init_point,
      /** Paso 2: una vez pagado el one-shot, el frontend abre esto para autorizar el recurrente. */
      preapprovalInitPoint: preapproval.init_point,
      addonSlug: p.addon.slug,
      prorationAllowed: p.allowProration,
      proratedAmountArs: Math.round(proratedArs * 100) / 100,
      proratedAmountUsd: proratedUsd,
      recurringAmountArs: Math.round(p.fullAmountArs * 100) / 100,
      recurringAmountUsd: p.usdAmount,
      exchangeRate: p.sellRate,
      billingPeriod: p.billingPeriod,
      nextChargeAt: p.mainCycleEnd,
      prorationFactor: Math.round(prorationFactor * 10000) / 10000,
    };
  }

  /** Redondeo HACIA ARRIBA a 1 decimal (ej: 1.57 → 1.6, 1.501 → 1.6, 1.5 → 1.5). */
  private ceilOneDecimal(n: number): number {
    return Math.ceil(n * 10) / 10;
  }

  async cancel(organizationId: string, addonSlug: string, actorUserId?: string) {
    const addon = await this.addons.getBySlug(addonSlug);
    const sub = await this.prisma.orgAddOnSubscription.findUnique({
      where: {
        organizationId_addonId: { organizationId, addonId: addon.id },
      },
    });
    if (!sub) {
      throw new NotFoundException(`No tenés suscripción al addon "${addonSlug}"`);
    }
    if (sub.status === SubscriptionStatus.CANCELED || sub.endedAt) {
      return sub;
    }

    if (sub.mpPreapprovalId) {
      try {
        await this.mp.cancel(sub.mpPreapprovalId);
      } catch (err) {
        this.logger.warn(
          `No pude cancelar preapproval ${sub.mpPreapprovalId}: ${String(err)}`,
        );
      }
    }

    const updated = await this.prisma.orgAddOnSubscription.update({
      where: { id: sub.id },
      data: {
        status: SubscriptionStatus.CANCELED,
        endedAt: new Date(),
      },
    });

    void this.audit.record({
      actorType: actorUserId ? AuditActor.USER : AuditActor.SYSTEM,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: 'addon.subscription_canceled',
      severity: 'warn',
      targetType: 'addon_subscription',
      targetId: sub.id,
      metadata: { addonSlug: addon.slug },
    });

    return updated;
  }

  /**
   * Handler del Payment one-time prorateado. Busca el AddOnPayment PENDING con
   * kind=oneshot asociado al subscriptionId (seteado vía external_reference) y
   * lo actualiza con el mpPaymentId + estado.
   */
  private async applyOneShotPaymentUpdate(
    subscriptionId: string,
    payment: MpPaymentData,
  ): Promise<void> {
    const sub = await this.prisma.orgAddOnSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub) {
      this.logger.warn(
        `Oneshot payment ${payment.id} para addonSub ${subscriptionId} inexistente`,
      );
      return;
    }

    const status = mapMpPaymentStatus(payment.status);

    // Buscamos el AddOnPayment PENDING que creamos al hacer subscribe (el que
    // todavía no tiene mpPaymentId). Si no existe (ej. webhook reordenado), lo creamos.
    const pending = await this.prisma.addOnPayment.findFirst({
      where: { subscriptionId, mpPaymentId: null },
      orderBy: { createdAt: 'desc' },
    });

    if (pending) {
      await this.prisma.addOnPayment.update({
        where: { id: pending.id },
        data: {
          mpPaymentId: String(payment.id),
          amountArs: payment.transaction_amount,
          status,
          paidAt: payment.date_approved ? new Date(payment.date_approved) : null,
          failureReason:
            status === PaymentStatus.REJECTED ? payment.status_detail : null,
          raw: payment as any,
        },
      });
    } else {
      await this.prisma.addOnPayment.create({
        data: {
          subscriptionId,
          mpPaymentId: String(payment.id),
          amountArs: payment.transaction_amount,
          amountUsd: Number(sub.lastAmountUsd ?? 0),
          exchangeRate: Number(sub.lastExchangeRate ?? 0),
          status,
          periodStart: sub.startedAt,
          periodEnd: sub.raw && (sub.raw as any).preapproval?.auto_recurring?.start_date
            ? new Date((sub.raw as any).preapproval.auto_recurring.start_date)
            : new Date(),
          paidAt: payment.date_approved ? new Date(payment.date_approved) : null,
          failureReason:
            status === PaymentStatus.REJECTED ? payment.status_detail : null,
          raw: payment as any,
        },
      });
    }

    // Al aprobarse el prorateo, marcamos la subscription como ACTIVE aunque el
    // preapproval recurrente todavía no haya cobrado (start_date en el futuro).
    if (status === PaymentStatus.APPROVED) {
      await this.prisma.orgAddOnSubscription.update({
        where: { id: subscriptionId },
        data: { status: SubscriptionStatus.ACTIVE },
      });
      void this.audit.record({
        actorType: AuditActor.SYSTEM,
        organizationId: sub.organizationId,
        action: 'addon.oneshot_payment_approved',
        targetType: 'addon_payment',
        targetId: String(payment.id),
        metadata: { addonSubscriptionId: subscriptionId },
      });
    }
  }

  /**
   * Webhook handler — preapproval update. Devuelve `true` si encontró una
   * addon subscription matcheando el preapprovalId (así el billing principal
   * sabe que fue manejado acá y no lo re-procesa).
   */
  async applyPreapprovalUpdate(mp: MpPreapprovalData): Promise<boolean> {
    const sub = await this.prisma.orgAddOnSubscription.findFirst({
      where: { mpPreapprovalId: mp.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return false;

    await this.prisma.orgAddOnSubscription.update({
      where: { id: sub.id },
      data: {
        status: mapMpPreapprovalStatus(mp.status),
        raw: mp as any,
      },
    });
    return true;
  }

  /**
   * Webhook handler — payment update. Devuelve `true` si el payment pertenece
   * a un addon (ya sea por `preapproval_id` del recurrente, o por
   * `external_reference` empezando con `addon_oneshot:` del prorrateo).
   */
  async applyPaymentUpdate(payment: MpPaymentData): Promise<boolean> {
    // Caso 1: one-time prorateado al agregar addon.
    const extRef = payment.external_reference ?? '';
    if (extRef.startsWith('addon_oneshot:')) {
      const subId = extRef.slice('addon_oneshot:'.length);
      await this.applyOneShotPaymentUpdate(subId, payment);
      return true;
    }

    // Caso 2: recurrente del addon (preapproval_id matchea).
    const preapprovalId = payment.preapproval_id;
    if (!preapprovalId) return false;

    const sub = await this.prisma.orgAddOnSubscription.findFirst({
      where: { mpPreapprovalId: preapprovalId },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return false;

    const status = mapMpPaymentStatus(payment.status);
    const sellRate = sub.lastExchangeRate
      ? Number(sub.lastExchangeRate)
      : await this.exchangeRate.getSellRate();
    const amountUsd = Number(sub.lastAmountUsd ?? 0) || 0;

    // Período del addon: misma lógica que plan principal (mensual / anual).
    const now = new Date();
    const periodEnd = new Date(now);
    if (sub.billingPeriod === BillingPeriod.ANNUAL) {
      periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
    } else {
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    }

    const existing = await this.prisma.addOnPayment.findUnique({
      where: { mpPaymentId: String(payment.id) },
    });

    if (existing) {
      await this.prisma.addOnPayment.update({
        where: { id: existing.id },
        data: {
          status,
          paidAt: payment.date_approved ? new Date(payment.date_approved) : null,
          raw: payment as any,
        },
      });
    } else {
      await this.prisma.addOnPayment.create({
        data: {
          subscriptionId: sub.id,
          mpPaymentId: String(payment.id),
          amountArs: payment.transaction_amount,
          amountUsd,
          exchangeRate: sellRate,
          status,
          periodStart: now,
          periodEnd,
          paidAt: payment.date_approved ? new Date(payment.date_approved) : null,
          failureReason:
            status === PaymentStatus.REJECTED ? payment.status_detail : null,
          raw: payment as any,
        },
      });
    }

    if (status === PaymentStatus.APPROVED) {
      await this.prisma.orgAddOnSubscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.ACTIVE },
      });
      void this.audit.record({
        actorType: AuditActor.SYSTEM,
        organizationId: sub.organizationId,
        action: 'addon.payment_approved',
        targetType: 'addon_payment',
        targetId: String(payment.id),
        metadata: {
          addonSubscriptionId: sub.id,
          amountArs: payment.transaction_amount,
          amountUsd,
        },
      });
    }

    return true;
  }
}
