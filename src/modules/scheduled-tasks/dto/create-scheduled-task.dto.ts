import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ScheduledTaskType } from '../../../../generated/prisma';

export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

const CRON_REGEX = /^(\S+\s+){4,5}\S+$/;

export class CreateScheduledTaskDto {
  @ApiProperty({ example: 'Factura mensual alquiler' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: ScheduledTaskType })
  @IsEnum(ScheduledTaskType)
  type: ScheduledTaskType;

  @ApiProperty({ description: 'UUID del certificate persistido cifrado' })
  @IsString()
  @IsNotEmpty()
  certificateId: string;

  @ApiProperty({
    enum: ['once', 'daily', 'weekly', 'monthly', 'yearly'],
    description:
      'Modo UI-friendly. Para power users, mandar `cronExpression` directamente y el resto se ignora.',
  })
  @IsEnum(['once', 'daily', 'weekly', 'monthly', 'yearly'])
  frequency: Frequency;

  @ApiPropertyOptional({ description: 'ISO date, obligatorio si frequency=once' })
  @IsOptional()
  @IsDateString()
  runOnce?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 23, example: 9 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 59, example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  minute?: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Para weekly: 0=domingo, 1=lunes, ..., 6=sábado',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({
    description: 'Cron expression directa (5 campos). Si viene, se ignoran los campos friendly.',
    example: '30 9 * * 1-5',
  })
  @IsOptional()
  @IsString()
  @Matches(CRON_REGEX, { message: 'cronExpression debe tener 5 o 6 campos separados por espacio' })
  cronExpression?: string;

  @ApiPropertyOptional({ example: 'America/Argentina/Buenos_Aires' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiProperty({
    description:
      'Body que se va a ejecutar contra el endpoint AFIP interno (ej: payload de createInvoice). El worker inyecta cert/key desde el storage cifrado.',
  })
  @IsObject()
  payload: Record<string, unknown>;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
