import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyCron } from './idempotency.cron';

@Global()
@Module({
  providers: [IdempotencyService, IdempotencyCron],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
