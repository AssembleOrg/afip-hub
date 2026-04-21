import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateEmisorDto {
  @ApiProperty({ example: '27389456782', description: 'CUIT del emisor (11 dígitos, sin guiones)' })
  @IsString()
  @Matches(/^\d{11}$/, { message: 'cuit debe tener 11 dígitos' })
  cuit: string;

  @ApiProperty({ description: 'Número de punto de venta habilitado en ARCA', example: 1 })
  @IsInt()
  @Min(1)
  puntoVenta: number;

  @ApiProperty({
    description:
      '`account` = el emisor delegó al CUIT del agente/tenant (usa cert de la cuenta). ' +
      '`platform` = el emisor delegó al CUIT maestro del SaaS (cert en env vars).',
    enum: ['account', 'platform'],
  })
  @IsIn(['account', 'platform'])
  mode: 'account' | 'platform';

  // ── Campos para mode === 'account' ──────────────────────────────────────────

  @ApiPropertyOptional({
    description: '[account] ID de un Certificate ya subido en la cuenta.',
  })
  @ValidateIf((o) => o.mode === 'account' && !o.crtFile)
  @IsUUID()
  certificateId?: string;

  @ApiPropertyOptional({
    description: '[account] Certificado X.509 en PEM (.crt). Requerido si no se envía certificateId.',
  })
  @ValidateIf((o) => o.mode === 'account' && !o.certificateId)
  @IsString()
  crtFile?: string;

  @ApiPropertyOptional({
    description: '[account] Clave privada RSA en PEM (.key). Requerida junto con crtFile.',
  })
  @ValidateIf((o) => o.mode === 'account' && !o.certificateId)
  @IsString()
  keyFile?: string;

  // ── Campos opcionales comunes ────────────────────────────────────────────────

  @ApiPropertyOptional({ description: 'Razón social (pre-completar desde padrón A13)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  razonSocial?: string;

  @ApiPropertyOptional({ description: 'Condición IVA (pre-completar desde padrón A13)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  condicionIva?: string;

  @ApiPropertyOptional({ description: 'Alias interno para identificar el emisor' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;

  @ApiPropertyOptional({ description: 'Si true, valida contra homologación AFIP', default: false })
  @IsOptional()
  @IsBoolean()
  homologacion?: boolean;
}
