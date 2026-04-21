import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { ALL_EVENT_TYPES } from '@/common/events';

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://api.mi-backend.com/webhooks/afip-hub' })
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url: string;

  @ApiProperty({
    description: 'Lista de event types a suscribir',
    example: ['payment.approved', 'invoice.emitted', 'quota.warning_80'],
    enum: ALL_EVENT_TYPES,
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ALL_EVENT_TYPES, { each: true })
  events: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url?: string;

  @ApiPropertyOptional({ enum: ALL_EVENT_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ALL_EVENT_TYPES, { each: true })
  events?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;
}
