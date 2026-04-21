import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditCron } from './audit.cron';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditCron],
  exports: [AuditService],
})
export class AuditModule {}
