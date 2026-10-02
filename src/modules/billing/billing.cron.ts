import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/database/prisma.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageService } from '@/modules/usage/usage.service';
import { SubscriptionStatus } from '../../../generated/prisma';

/**
 * Corre cada hora. Para cada org con suscripción ACTIVE cuyo `currentPeriodEnd`
 * esté dentro de las próximas 24h, recalcula el monto ARS con el blue actual y
 * actualiza el preapproval en MP. MP dispara el cobro automáticamente al
 * vencimiento del ciclo.
 */
@Injectable()
export class BillingCron {
  private readonly logger = new Logger(BillingCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly usage: UsageService,
  ) {}

  /**
   * Las orgs sin suscripción en MercadoPago (Free, canceladas o con plan
   * asignado por admin) no tienen un pago que avance el período: lo avanzamos
   * acá para que el cupo se renueve todos los meses.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'period-rollover-free' })
  async rollFreePeriods() {
    const now = new Date();
    const due = await this.prisma.organization.findMany({
      where: { mpPreapprovalId: null, currentPeriodEnd: { lte: now }, deletedAt: null },
      select: { id: true, slug: true },
    });
    for (const org of due) {
      try {
        // Puede estar atrasada varios meses: avanzamos hasta el ciclo vigente.
        for (let i = 0; i < 24; i++) {
          await this.usage.rollToNextPeriod(org.id);
          const fresh = await this.prisma.organization.findUnique({
            where: { id: org.id },
            select: { currentPeriodEnd: true },
          });
          if (!fresh || fresh.currentPeriodEnd > now) break;
        }
      } catch (err) {
        this.logger.error(`Fallo rollover org=${org.slug}: ${String(err)}`);
      }
    }
    if (due.length > 0) this.logger.log(`Período renovado para ${due.length} orgs sin suscripción`);
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'billing-recalc' })
  async recalcUpcomingAmounts() {
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.organization.findMany({
      where: {
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        mpPreapprovalId: { not: null },
        currentPeriodEnd: { lte: in24h },
      },
      select: { id: true, slug: true },
    });

    if (candidates.length === 0) return;

    this.logger.log(
      `Recalculando monto ARS para ${candidates.length} suscripciones próximas a cobrar`,
    );

    for (const org of candidates) {
      try {
        const r = await this.subscriptions.recalcUpcomingAmount(org.id);
        if (r.updated) {
          this.logger.log(
            `org=${org.slug} actualizado a $${r.newAmountArs?.toFixed(2)} ARS`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Fallo recalc org=${org.slug}: ${String(err)}`,
        );
      }
    }
  }
}
