import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from './audit.service';

@Injectable()
export class AuditCron {
  private readonly logger = new Logger(AuditCron.name);

  constructor(private readonly service: AuditService) {}

  /** Diario a las 3am: borra auditoría más vieja que 13 meses. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'audit-purge' })
  async purge() {
    const n = await this.service.purgeOld(395);
    if (n > 0) this.logger.log(`Purgados ${n} audit logs >13 meses`);
  }
}
