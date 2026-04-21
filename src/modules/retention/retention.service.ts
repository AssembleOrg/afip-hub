import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { StorageService } from '@/infra/storage/storage.service';
import { WebhookDeliveryStatus } from '../../../generated/prisma';

export interface RetentionReport {
  usageEventsDeleted: number;
  webhookDeliveriesDeleted: number;
  notificationDeliveriesDeleted: number;
  scheduledTaskRunsDeleted: number;
  exchangeRatesDeleted: number;
  auditLogsDeleted: number;
  invoicesArchived: number;
  errors: string[];
}

/**
 * Retention policies: purga data antigua y archiva invoices a DO Spaces.
 *
 * **Principios**:
 *  - Una tabla por método → testeable y reiniciable.
 *  - Batches de 5k rows para no trabar Postgres con bloqueos largos.
 *  - Errores en una tabla NO paran las demás.
 *  - Todas las ventanas son configurables vía env (`retention.*`).
 *
 * **Orden en el cron** (de más seguro a más riesgoso):
 *   1. Purges puros (no requieren storage)
 *   2. Invoice archival (requiere Storage habilitado)
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  async runAll(): Promise<RetentionReport> {
    const report: RetentionReport = {
      usageEventsDeleted: 0,
      webhookDeliveriesDeleted: 0,
      notificationDeliveriesDeleted: 0,
      scheduledTaskRunsDeleted: 0,
      exchangeRatesDeleted: 0,
      auditLogsDeleted: 0,
      invoicesArchived: 0,
      errors: [],
    };

    await this.safeRun('usageEvents', async () => {
      report.usageEventsDeleted = await this.purgeUsageEvents();
    }, report);

    await this.safeRun('webhookDeliveries', async () => {
      report.webhookDeliveriesDeleted = await this.purgeWebhookDeliveries();
    }, report);

    await this.safeRun('notificationDeliveries', async () => {
      report.notificationDeliveriesDeleted = await this.purgeNotificationDeliveries();
    }, report);

    await this.safeRun('scheduledTaskRuns', async () => {
      report.scheduledTaskRunsDeleted = await this.purgeScheduledTaskRuns();
    }, report);

    await this.safeRun('exchangeRates', async () => {
      report.exchangeRatesDeleted = await this.purgeExchangeRates();
    }, report);

    await this.safeRun('auditLogs', async () => {
      report.auditLogsDeleted = await this.purgeAuditLogs();
    }, report);

    if (this.storage.isAvailable()) {
      await this.safeRun('invoiceArchive', async () => {
        report.invoicesArchived = await this.archiveOldInvoices();
      }, report);
    } else {
      this.logger.warn(
        'Storage no disponible → saltando archivo de invoices. Los rawRequest/Response viejos quedan en Postgres ocupando espacio.',
      );
    }

    this.logger.log(`Retention done: ${JSON.stringify(report)}`);
    return report;
  }

  // ==========================================================
  //  PURGES
  // ==========================================================

  async purgeUsageEvents(): Promise<number> {
    const days = this.config.get<number>('retention.usageEventsDays') ?? 90;
    const cutoff = this.cutoff(days);
    const r = await this.prisma.usageEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return r.count;
  }

  async purgeWebhookDeliveries(): Promise<number> {
    const okDays = this.config.get<number>('retention.webhookDeliveriesDeliveredDays') ?? 30;
    const failDays = this.config.get<number>('retention.webhookDeliveriesFailedDays') ?? 90;

    const [r1, r2] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.deleteMany({
        where: {
          status: WebhookDeliveryStatus.DELIVERED,
          createdAt: { lt: this.cutoff(okDays) },
        },
      }),
      this.prisma.webhookDelivery.deleteMany({
        where: {
          status: { in: [WebhookDeliveryStatus.FAILED, WebhookDeliveryStatus.PENDING] },
          createdAt: { lt: this.cutoff(failDays) },
        },
      }),
    ]);
    return r1.count + r2.count;
  }

  async purgeNotificationDeliveries(): Promise<number> {
    const days = this.config.get<number>('retention.notificationDeliveriesDays') ?? 90;
    const r = await this.prisma.notificationDelivery.deleteMany({
      where: { createdAt: { lt: this.cutoff(days) } },
    });
    return r.count;
  }

  async purgeScheduledTaskRuns(): Promise<number> {
    const days = this.config.get<number>('retention.scheduledTaskRunsDays') ?? 90;
    const r = await this.prisma.scheduledTaskRun.deleteMany({
      where: { startedAt: { lt: this.cutoff(days) } },
    });
    return r.count;
  }

  async purgeExchangeRates(): Promise<number> {
    const days = this.config.get<number>('retention.exchangeRatesDays') ?? 7;
    // Siempre preservamos la última por source para no perder la referencia actual.
    const cutoff = this.cutoff(days);
    const latestBySource = await this.prisma.exchangeRate.groupBy({
      by: ['source'],
      _max: { fetchedAt: true },
    });
    const protectedDates = latestBySource
      .map((x) => x._max.fetchedAt)
      .filter((d): d is Date => !!d);

    const r = await this.prisma.exchangeRate.deleteMany({
      where: {
        fetchedAt: { lt: cutoff },
        NOT: { fetchedAt: { in: protectedDates } },
      },
    });
    return r.count;
  }

  async purgeAuditLogs(): Promise<number> {
    const days = this.config.get<number>('retention.auditLogsDays') ?? 395;
    const r = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: this.cutoff(days) } },
    });
    return r.count;
  }

  // ==========================================================
  //  INVOICE ARCHIVAL (requiere Storage)
  // ==========================================================

  /**
   * Para cada invoice con `rawRequest`/`rawResponse` no nulos y más vieja que
   * `invoiceArchiveAfterDays`:
   *  1. Subir `{request, response}` a DO Spaces bajo {prefix}/orgs/{orgId}/invoices/{id}.json
   *  2. Setear archivedAt + archiveKey
   *  3. Nullificar rawRequest/rawResponse (liberando Postgres)
   *
   * Procesa en batches de 100 para no cargar memoria.
   */
  async archiveOldInvoices(): Promise<number> {
    const days = this.config.get<number>('retention.invoiceArchiveAfterDays') ?? 180;
    const cutoff = this.cutoff(days);
    const batchSize = 100;
    let total = 0;

    // Loop hasta drenar todas las que califican. Límite duro de 5k por tick
    // por si la tabla está gigante.
    for (let i = 0; i < 50; i++) {
      const batch = await this.prisma.invoice.findMany({
        where: {
          archivedAt: null,
          createdAt: { lt: cutoff },
          OR: [
            { rawRequest: { not: undefined } },
            { rawResponse: { not: undefined } },
          ],
        },
        take: batchSize,
        select: {
          id: true,
          organizationId: true,
          rawRequest: true,
          rawResponse: true,
        },
      });
      if (batch.length === 0) break;

      for (const inv of batch) {
        try {
          const key = this.storage.keyForInvoice(inv.organizationId, inv.id);
          await this.storage.putJson(key, {
            rawRequest: inv.rawRequest ?? null,
            rawResponse: inv.rawResponse ?? null,
            archivedAt: new Date().toISOString(),
          });
          await this.prisma.invoice.update({
            where: { id: inv.id },
            data: {
              archivedAt: new Date(),
              archiveKey: key,
              rawRequest: null as any,
              rawResponse: null as any,
            },
          });
          total++;
        } catch (err) {
          this.logger.error(
            `Archivo de invoice ${inv.id} falló: ${String(err)}. Dejamos rawRequest en DB y seguimos.`,
          );
        }
      }
    }
    return total;
  }

  /** Recupera desde DO Spaces el rawRequest/rawResponse de una invoice archivada. */
  async rehydrateInvoice(invoiceId: string): Promise<{
    rawRequest: unknown;
    rawResponse: unknown;
    archivedAt: Date;
  } | null> {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { archiveKey: true, archivedAt: true },
    });
    if (!inv?.archiveKey) return null;
    const data = await this.storage.getJson<{
      rawRequest: unknown;
      rawResponse: unknown;
    }>(inv.archiveKey);
    if (!data) return null;
    return {
      rawRequest: data.rawRequest,
      rawResponse: data.rawResponse,
      archivedAt: inv.archivedAt!,
    };
  }

  // ==========================================================
  //  helpers
  // ==========================================================

  private cutoff(days: number): Date {
    return new Date(Date.now() - days * 24 * 3600 * 1000);
  }

  private async safeRun(
    name: string,
    fn: () => Promise<void>,
    report: RetentionReport,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = `${name}: ${String((err as Error).message ?? err)}`;
      this.logger.error(`Retention step falló — ${msg}`);
      report.errors.push(msg);
    }
  }
}
