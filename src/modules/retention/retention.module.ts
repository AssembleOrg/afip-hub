import { Global, Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionCron } from './retention.cron';
import { RetentionController } from './retention.controller';

@Global()
@Module({
  controllers: [RetentionController],
  providers: [RetentionService, RetentionCron],
  exports: [RetentionService],
})
export class RetentionModule {}
