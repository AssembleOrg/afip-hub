import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RetentionService } from './retention.service';

/**
 * Retention corre **diario a las 4am** (GMT-3). Una vez al día es suficiente;
 * las purgas son pesadas y queremos que ocurran fuera de horario de uso.
 */
@Injectable()
export class RetentionCron {
  private readonly logger = new Logger(RetentionCron.name);
  private running = false;

  constructor(private readonly retention: RetentionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, {
    name: 'retention-daily',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async daily() {
    if (this.running) return;
    this.running = true;
    try {
      const report = await this.retention.runAll();
      this.logger.log(
        `Retention diario OK: ${report.usageEventsDeleted} usage, ${report.webhookDeliveriesDeleted} webhooks, ` +
          `${report.invoicesArchived} invoices archivadas, ${report.auditLogsDeleted} audit, ` +
          `errores=${report.errors.length}`,
      );
    } catch (err) {
      this.logger.error(`Retention diario falló: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
