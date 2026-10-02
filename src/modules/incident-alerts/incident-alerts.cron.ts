import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IncidentAlertsService } from './incident-alerts.service';

/** Cada 5 minutos revisa si hay una racha de fallas 5xx y avisa a los admins. */
@Injectable()
export class IncidentAlertsCron {
  private readonly logger = new Logger(IncidentAlertsCron.name);

  constructor(private readonly service: IncidentAlertsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'incident-alerts' })
  async tick() {
    try {
      await this.service.check();
    } catch (err) {
      this.logger.error(`incident-alerts tick falló: ${String(err)}`);
    }
  }
}
