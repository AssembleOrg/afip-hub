import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/database/prisma.service';
import { SubscriptionsService } from './subscriptions.service';
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
  ) {}

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
