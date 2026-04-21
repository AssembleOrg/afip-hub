import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class IdempotencyCron {
  private readonly logger = new Logger(IdempotencyCron.name);

  constructor(private readonly service: IdempotencyService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'idempotency-purge' })
  async purge() {
    const n = await this.service.purgeExpired();
    if (n > 0) {
      this.logger.log(`Purgadas ${n} idempotency keys expiradas`);
    }
  }
}
