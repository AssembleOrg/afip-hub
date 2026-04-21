import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListEmisoresDto {
  @ApiPropertyOptional({ description: 'Buscar por cuit / razón social / alias' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: false, description: 'Incluir emisores soft-deleted (dentro de 28d)' })
  @IsOptional()
  @Type(() => Boolean)
  includeDeleted?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
