import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

export class CreateCreditNoteDto {
  @ApiProperty({ description: 'Certificado AFIP en PEM', required: true })
  @IsString()
  certificado: string;

  @ApiProperty({ description: 'Clave privada AFIP en PEM', required: true })
  @IsString()
  clavePrivada: string;

  @ApiPropertyOptional({
    description: 'Importe neto gravado (si no se envía, se copia de la factura original)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeNetoGravado?: number;

  @ApiPropertyOptional({ description: 'Importe IVA (default: el de la factura original)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeIva?: number;

  @ApiPropertyOptional({ description: 'Importe tributos (default: el de la factura original)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeTributos?: number;

  @ApiPropertyOptional({
    description: 'Importe total de la NC (default: total factura original; no puede excederlo)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeTotal?: number;

  @ApiPropertyOptional({
    description: 'Fecha del comprobante YYYYMMDD (default: hoy)',
    example: '20260420',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{8}$/)
  fechaComprobante?: string;

  @ApiPropertyOptional({ description: 'Motivo descriptivo (para auditoría local, no va a AFIP)' })
  @IsOptional()
  @IsString()
  motivo?: string;

  @ApiPropertyOptional({
    description:
      'Si es NC de anulación (inyecta opcional 22=S). Default: false para NC FCE (obligatorio), undefined para NC no FCE. Si true, la NC debe asociar ND (no Factura).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  esAnulacion?: boolean;
}
