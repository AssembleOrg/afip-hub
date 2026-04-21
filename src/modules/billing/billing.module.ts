import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { MercadoPagoService } from './mercadopago.service';
import { SubscriptionsService } from './subscriptions.service';
import { BillingCron } from './billing.cron';

@Global()
@Module({
  controllers: [BillingController],
  providers: [MercadoPagoService, SubscriptionsService, BillingCron],
  exports: [SubscriptionsService, MercadoPagoService],
})
export class BillingModule {}
