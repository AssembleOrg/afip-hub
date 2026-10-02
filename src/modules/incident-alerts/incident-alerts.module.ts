import { Module } from '@nestjs/common';
import { IncidentAlertsService } from './incident-alerts.service';
import { IncidentAlertsCron } from './incident-alerts.cron';

@Module({
  providers: [IncidentAlertsService, IncidentAlertsCron],
  exports: [IncidentAlertsService],
})
export class IncidentAlertsModule {}
