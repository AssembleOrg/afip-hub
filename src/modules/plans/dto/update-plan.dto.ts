import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Precio mensual en USD' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  requestsLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  cuitLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  pdfRateLimitPerMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  taRateLimitPerMin?: number;

  @ApiPropertyOptional({ description: '1.02 = 2% de gracia sobre el límite' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(1)
  @Max(2)
  graceFactor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
