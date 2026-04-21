import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SelfBillingService } from './self-billing.service';

/**
 * Una vez por hora reintenta PlatformInvoice en FAILED. El backoff natural
 * viene dado por la frecuencia (no reintentamos más de 24 veces/día), que es
 * suficiente considerando que el max_retries default es 5.
 */
@Injectable()
export class SelfBillingCron {
  private readonly logger = new Logger(SelfBillingCron.name);
  private running = false;

  constructor(private readonly service: SelfBillingService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'self-billing-retries' })
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.service.processRetries(20);
      if (r.retried > 0) {
        this.logger.log(`Self-billing retries: ${r.retried} platform invoices re-intentadas`);
      }
    } catch (err) {
      this.logger.error(`Self-billing cron falló: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
