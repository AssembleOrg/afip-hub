import { Module } from '@nestjs/common';
import { StorageAlertsService } from './storage-alerts.service';
import { StorageAlertsListener } from './storage-alerts.listener';
import { StorageAlertsCron } from './storage-alerts.cron';

@Module({
  providers: [StorageAlertsService, StorageAlertsListener, StorageAlertsCron],
  exports: [StorageAlertsService],
})
export class StorageAlertsModule {}
