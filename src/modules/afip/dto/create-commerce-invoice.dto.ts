import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  AlicuotaIva,
  CbuDto,
  ComprobanteAsociadoDto,
  Concepto,
  CondicionIvaReceptor,
  TipoComprobante,
  TipoDocumento,
} from './create-invoice.dto';

export class CommerceInvoiceItemDto {
  @ApiProperty({ description: 'Descripción del producto/servicio', example: 'Remera algodón blanca' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiPropertyOptional({ description: 'Código interno/SKU del ítem', example: 'SKU-REM-001' })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiProperty({ description: 'Cantidad', example: 2 })
  @IsNumber()
  @Min(0.000001)
  cantidad: number;

  @ApiProperty({ description: 'Precio unitario sin IVA', example: 15000 })
  @IsNumber()
  @Min(0)
  precioUnitario: number;

  @ApiPropertyOptional({
    description: 'Bonificación/descuento absoluto para la línea (sin IVA)',
    example: 1000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bonificacion?: number;

  @ApiPropertyOptional({
    description: 'Alícuota de IVA aplicada al ítem',
    enum: AlicuotaIva,
    example: AlicuotaIva.IVA_21,
    default: AlicuotaIva.IVA_21,
  })
  @IsOptional()
  @IsEnum(AlicuotaIva)
  alicuotaIva?: AlicuotaIva;
}

export class CreateCommerceInvoiceDto {
  @ApiProperty({ description: 'Punto de venta', example: 1 })
  @IsNumber()
  @Min(1)
  puntoVenta: number;

  @ApiProperty({ description: 'Tipo de comprobante', enum: TipoComprobante, example: TipoComprobante.FACTURA_B })
  @IsEnum(TipoComprobante)
  tipoComprobante: TipoComprobante;

  @ApiPropertyOptional({
    description: 'Número de comprobante. Si es 0 o no se envía, se obtiene automáticamente',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  numeroComprobante?: number;

  @ApiProperty({ description: 'Fecha del comprobante (YYYYMMDD)', example: '20260408' })
  @IsString()
  @IsNotEmpty()
  fechaComprobante: string;

  @ApiProperty({ description: 'CUIT/CUIL/DNI del cliente (sin guiones)', example: '20123456789' })
  @IsString()
  @IsNotEmpty()
  cuitCliente: string;

  @ApiProperty({ description: 'Tipo de documento del cliente', enum: TipoDocumento, example: TipoDocumento.CUIT })
  @IsEnum(TipoDocumento)
  tipoDocumento: TipoDocumento;

  @ApiPropertyOptional({
    description: 'Condición frente al IVA del receptor',
    enum: CondicionIvaReceptor,
    example: CondicionIvaReceptor.CONSUMIDOR_FINAL,
  })
  @IsOptional()
  @IsEnum(CondicionIvaReceptor)
  condicionIvaReceptor?: CondicionIvaReceptor;

  @ApiPropertyOptional({ description: 'Concepto de la operación', enum: Concepto, example: Concepto.PRODUCTOS, default: Concepto.PRODUCTOS })
  @IsOptional()
  @IsEnum(Concepto)
  concepto?: Concepto;

  @ApiProperty({
    description: 'Items del comprobante (permite múltiples productos)',
    type: [CommerceInvoiceItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommerceInvoiceItemDto)
  items: CommerceInvoiceItemDto[];

  @ApiPropertyOptional({ description: 'Importe de tributos adicionales', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeTributos?: number;

  @ApiPropertyOptional({ description: 'Moneda ID (PES, DOL, EUR, etc.)', example: 'PES' })
  @IsOptional()
  @IsString()
  monedaId?: string;

  @ApiPropertyOptional({ description: 'Cotización de la moneda (1 para PES)', example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cotizacionMoneda?: number;

  @ApiPropertyOptional({
    description: 'Comprobantes asociados (requerido para Notas de Crédito/Débito)',
    type: [ComprobanteAsociadoDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComprobanteAsociadoDto)
  comprobantesAsociados?: ComprobanteAsociadoDto[];

  @ApiPropertyOptional({ description: 'Datos del CBU (requerido para Facturas de Crédito Electrónica)', type: CbuDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CbuDto)
  cbu?: CbuDto;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento del pago para FCE (YYYYMMDD)' })
  @IsOptional()
  @IsString()
  fceVtoPago?: string;

  @ApiPropertyOptional({ description: 'Fecha desde del servicio (YYYYMMDD) - Solo Concepto 2 o 3' })
  @IsOptional()
  @IsString()
  fechaServicioDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta del servicio (YYYYMMDD) - Solo Concepto 2 o 3' })
  @IsOptional()
  @IsString()
  fechaServicioHasta?: string;

  @ApiPropertyOptional({ description: 'Fecha vencimiento pago (YYYYMMDD) - Solo Concepto 2 o 3' })
  @IsOptional()
  @IsString()
  fechaVencimientoPago?: string;

  @ApiProperty({ description: 'CUIT del emisor (sin guiones)', example: '20123456789' })
  @IsString()
  @IsNotEmpty()
  cuitEmisor: string;

  @ApiProperty({ description: 'Certificado digital (.crt) en formato PEM' })
  @IsString()
  @IsNotEmpty()
  certificado: string;

  @ApiProperty({ description: 'Clave privada (.key) en formato PEM' })
  @IsString()
  @IsNotEmpty()
  clavePrivada: string;

  @ApiPropertyOptional({
    description: 'Usar entorno de homologación/testing (true) o producción (false). Default: false',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  homologacion?: boolean;
}
