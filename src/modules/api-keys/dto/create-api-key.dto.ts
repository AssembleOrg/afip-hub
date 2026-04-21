import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Producción — backend principal' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({
    example: '2027-01-01T00:00:00.000Z',
    description: 'ISO 8601. Si se omite, la key no expira.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
