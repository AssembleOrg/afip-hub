import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsEnum } from 'class-validator';

/**
 * DTO para consultar parámetros de AFIP
 */
export class AfipParamsRequestDto {
  @ApiProperty({ 
    description: 'CUIT del emisor (sin guiones)', 
    example: '20123456789',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  cuitEmisor: string;

  @ApiProperty({ 
    description: 'Certificado digital (.crt) en formato PEM',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  certificado: string;

  @ApiProperty({ 
    description: 'Clave privada (.key) en formato PEM',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  clavePrivada: string;
}

/**
 * DTO para consultar condiciones IVA
 */
export class CondicionesIvaRequestDto extends AfipParamsRequestDto {
  @ApiProperty({ 
    description: 'Clase de comprobante (A, B, C, M) - Opcional, si no se envía devuelve todas',
    example: 'C',
    required: false
  })
  @IsOptional()
  @IsString()
  claseComprobante?: string;
}

/**
 * Response para tipos de comprobante
 */
export class TipoComprobanteResponseDto {
  @ApiProperty({ description: 'ID del tipo de comprobante', example: 1 })
  Id: number;

  @ApiProperty({ description: 'Descripción del tipo', example: 'Factura A' })
  Desc: string;

  @ApiProperty({ description: 'Fecha desde habilitado', example: '20100401' })
  FchDesde: string;

  @ApiProperty({ description: 'Fecha hasta habilitado', example: 'NULL' })
  FchHasta: string;
}

/**
 * Response para puntos de venta
 */
export class PuntoVentaResponseDto {
  @ApiProperty({ description: 'Número de punto de venta', example: 1 })
  Nro: number;

  @ApiProperty({ description: 'Tipo de emisión', example: 'CAE' })
  EmisionTipo: string;

  @ApiProperty({ description: 'Estado de bloqueo', example: 'N' })
  Bloqueado: string;

  @ApiProperty({ description: 'Fecha de baja', example: 'NULL' })
  FchBaja: string;
}

/**
 * Response para condiciones IVA receptor
 */
export class CondicionIvaReceptorResponseDto {
  @ApiProperty({ description: 'ID de la condición', example: 5 })
  Id: number;

  @ApiProperty({ description: 'Descripción de la condición', example: 'Consumidor Final' })
  Desc: string;

  @ApiProperty({ description: 'Clase de comprobante', example: 'C' })
  Cmp_Clase: string;
}

/**
 * DTO para generar código QR
 */
export class GenerarQrRequestDto {
  @ApiProperty({ description: 'CUIT del emisor', example: '20123456789' })
  @IsString()
  @IsNotEmpty()
  cuit: string;

  @ApiProperty({ description: 'Punto de venta', example: 1 })
  ptoVta: number;

  @ApiProperty({ description: 'Tipo de comprobante', example: 6 })
  tipoCmp: number;

  @ApiProperty({ description: 'Número de comprobante', example: 1 })
  nroCmp: number;

  @ApiProperty({ description: 'Fecha de emisión (YYYYMMDD)', example: '20251205' })
  @IsString()
  @IsNotEmpty()
  fecha: string;

  @ApiProperty({ description: 'Importe total', example: 1210.0 })
  importe: number;

  @ApiProperty({ description: 'Moneda', example: 'PES' })
  @IsString()
  moneda: string;

  @ApiProperty({ description: 'Cotización', example: 1 })
  ctz: number;

  @ApiProperty({ description: 'Tipo de documento del receptor', example: 80 })
  tipoDocRec: number;

  @ApiProperty({ description: 'Número de documento del receptor', example: '20123456789' })
  @IsString()
  nroDocRec: string;

  @ApiProperty({ description: 'CAE', example: '71234567890123' })
  @IsString()
  @IsNotEmpty()
  cae: string;
}

