import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class VerifyInvoiceDto {
  @ApiProperty({ description: 'Certificado AFIP en PEM', required: true })
  @IsString()
  certificado: string;

  @ApiProperty({ description: 'Clave privada AFIP en PEM', required: true })
  @IsString()
  clavePrivada: string;

  @ApiPropertyOptional({
    description:
      'Modo de autorización. Default CAE (el flujo normal de facturación electrónica).',
    enum: ['CAE', 'CAI', 'CAEA'],
    default: 'CAE',
  })
  @IsOptional()
  @IsString()
  cbteModo?: 'CAE' | 'CAI' | 'CAEA';
}
