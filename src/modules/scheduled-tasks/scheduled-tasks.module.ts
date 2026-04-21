import { Module } from '@nestjs/common';
import { ScheduledTasksService } from './scheduled-tasks.service';
import { ScheduledTasksController } from './scheduled-tasks.controller';
import { ScheduledTasksWorker } from './scheduled-tasks.worker';

@Module({
  controllers: [ScheduledTasksController],
  providers: [ScheduledTasksService, ScheduledTasksWorker],
  exports: [ScheduledTasksService],
})
export class ScheduledTasksModule {}
