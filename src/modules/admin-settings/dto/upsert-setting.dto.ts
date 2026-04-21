import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpsertSettingDto {
  @ApiProperty({
    description:
      'Valor a guardar (cualquier JSON válido: string, number, object, array, boolean)',
  })
  value: unknown;

  @ApiPropertyOptional({ description: 'Descripción para dashboards' })
  @IsOptional()
  @IsString()
  description?: string;
}
