import { Global, Module } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service';
import { ExchangeRateController } from './exchange-rate.controller';

@Global()
@Module({
  controllers: [ExchangeRateController],
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class ExchangeRateModule {}
