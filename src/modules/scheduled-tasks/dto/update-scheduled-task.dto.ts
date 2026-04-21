import { PartialType } from '@nestjs/swagger';
import { CreateScheduledTaskDto } from './create-scheduled-task.dto';

export class UpdateScheduledTaskDto extends PartialType(CreateScheduledTaskDto) {}
