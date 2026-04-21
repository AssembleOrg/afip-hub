import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEmisorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  razonSocial?: string | null;
}
