import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ExchangeRateModule } from '@/modules/exchange-rate';

@Module({
  imports: [ExchangeRateModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
