import { Module } from '@nestjs/common';
import { SelfBillingService } from './self-billing.service';
import { SelfBillingListener } from './self-billing.listener';
import { SelfBillingCron } from './self-billing.cron';
import { SelfBillingController } from './self-billing.controller';

@Module({
  controllers: [SelfBillingController],
  providers: [SelfBillingService, SelfBillingListener, SelfBillingCron],
  exports: [SelfBillingService],
})
export class SelfBillingModule {}
