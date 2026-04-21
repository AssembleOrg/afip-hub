import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';

@Global()
@Module({
  providers: [NotificationsService, NotificationsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
