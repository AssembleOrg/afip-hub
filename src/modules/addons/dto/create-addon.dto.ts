import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { PlanChannel } from '../../../../generated/prisma';

export class CreateAddOnDto {
  @ApiProperty({ example: 'whatsapp-bot' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug debe ser lowercase con guiones' })
  slug: string;

  @ApiProperty({ example: 'Bot de WhatsApp' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: PlanChannel, default: PlanChannel.BOTH })
  @IsOptional()
  @IsEnum(PlanChannel)
  channel?: PlanChannel;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(0)
  priceUsd: number;

  @ApiPropertyOptional({ description: 'Precio anual (×10 recomendado)', example: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualPriceUsd?: number;

  @ApiPropertyOptional({ example: { whatsappBot: true, maxContacts: 1000 } })
  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @ApiPropertyOptional({
    default: true,
    description:
      'Si true: admite prorrateo al contratar mid-cycle (cobra fracción del mes). Si false: cobra precio completo sin importar cuándo se contrate (anti-abuso).',
  })
  @IsOptional()
  @IsBoolean()
  allowProration?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
