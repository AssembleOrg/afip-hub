import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InvoicePdfItemDto {
  @ApiProperty({ description: 'Código del producto/servicio', example: 'PROD-001' })
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({ description: 'Descripción del producto/servicio', example: 'Servicio de desarrollo web' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiProperty({ description: 'Cantidad', example: 1 })
  @IsNumber()
  @Min(0)
  cantidad: number;

  @ApiProperty({ description: 'Unidad de medida', example: 'unidad' })
  @IsOptional()
  @IsString()
  unidad?: string;

  @ApiProperty({ description: 'Precio unitario', example: 1000.0 })
  @IsNumber()
  @Min(0)
  precioUnitario: number;

  @ApiPropertyOptional({ description: 'Porcentaje de bonificación', example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bonificacion?: number;

  @ApiProperty({ description: 'Subtotal del ítem', example: 1000.0 })
  @IsNumber()
  @Min(0)
  subtotal: number;

  @ApiPropertyOptional({ description: 'Alícuota IVA (%)', example: 21 })
  @IsOptional()
  @IsNumber()
  alicuotaIva?: number;

  @ApiPropertyOptional({ description: 'Importe IVA del ítem', example: 210.0 })
  @IsOptional()
  @IsNumber()
  importeIva?: number;
}

export class InvoicePdfEmisorDto {
  @ApiProperty({ description: 'Razón social del emisor', example: 'Mi Empresa S.A.' })
  @IsString()
  @IsNotEmpty()
  razonSocial: string;

  @ApiProperty({ description: 'CUIT del emisor (sin guiones)', example: '20123456789' })
  @IsString()
  @IsNotEmpty()
  cuit: string;

  @ApiProperty({
    description: 'Condición frente al IVA del emisor',
    example: 'IVA Responsable Inscripto',
  })
  @IsString()
  @IsNotEmpty()
  condicionIva: string;

  @ApiProperty({ description: 'Domicilio comercial', example: 'Av. Corrientes 1234, CABA' })
  @IsString()
  @IsNotEmpty()
  domicilio: string;

  @ApiPropertyOptional({ description: 'Inicio de actividades (DD/MM/YYYY)', example: '01/01/2020' })
  @IsOptional()
  @IsString()
  inicioActividades?: string;

  @ApiPropertyOptional({ description: 'Número de IIBB', example: '901-123456-7' })
  @IsOptional()
  @IsString()
  iibb?: string;
}

export class InvoicePdfReceptorDto {
  @ApiProperty({ description: 'Razón social o nombre del receptor', example: 'Cliente S.R.L.' })
  @IsString()
  @IsNotEmpty()
  razonSocial: string;

  @ApiProperty({ description: 'CUIT/CUIL/DNI del receptor', example: '30712345678' })
  @IsString()
  @IsNotEmpty()
  documento: string;

  @ApiProperty({ description: 'Tipo de documento', example: 'CUIT' })
  @IsString()
  @IsNotEmpty()
  tipoDocumento: string;

  @ApiProperty({
    description: 'Condición frente al IVA del receptor',
    example: 'IVA Responsable Inscripto',
  })
  @IsString()
  @IsNotEmpty()
  condicionIva: string;

  @ApiPropertyOptional({ description: 'Domicilio del receptor', example: 'Av. Santa Fe 5678, CABA' })
  @IsOptional()
  @IsString()
  domicilio?: string;
}

export class GenerateInvoicePdfDto {
  // --- Datos del comprobante ---
  @ApiProperty({
    description: 'Tipo de comprobante legible',
    example: 'FACTURA B',
  })
  @IsString()
  @IsNotEmpty()
  tipoComprobante: string;

  @ApiProperty({
    description: 'Letra del comprobante (A, B, C, M)',
    example: 'B',
  })
  @IsString()
  @IsNotEmpty()
  letra: string;

  @ApiProperty({ description: 'Punto de venta', example: 1 })
  @IsNumber()
  @Min(1)
  puntoVenta: number;

  @ApiProperty({ description: 'Número de comprobante', example: 1 })
  @IsNumber()
  @Min(1)
  numeroComprobante: number;

  @ApiProperty({ description: 'Fecha de emisión (DD/MM/YYYY)', example: '05/12/2025' })
  @IsString()
  @IsNotEmpty()
  fechaEmision: string;

  // --- CAE ---
  @ApiProperty({ description: 'Código de Autorización Electrónico', example: '71234567890123' })
  @IsString()
  @IsNotEmpty()
  cae: string;

  @ApiProperty({ description: 'Fecha de vencimiento del CAE (DD/MM/YYYY)', example: '15/12/2025' })
  @IsString()
  @IsNotEmpty()
  caeFechaVencimiento: string;

  // --- Emisor ---
  @ApiProperty({ description: 'Datos del emisor', type: InvoicePdfEmisorDto })
  @ValidateNested()
  @Type(() => InvoicePdfEmisorDto)
  emisor: InvoicePdfEmisorDto;

  // --- Receptor ---
  @ApiProperty({ description: 'Datos del receptor', type: InvoicePdfReceptorDto })
  @ValidateNested()
  @Type(() => InvoicePdfReceptorDto)
  receptor: InvoicePdfReceptorDto;

  // --- Ítems ---
  @ApiProperty({ description: 'Detalle de ítems', type: [InvoicePdfItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoicePdfItemDto)
  items: InvoicePdfItemDto[];

  // --- Importes ---
  @ApiProperty({ description: 'Importe neto gravado', example: 1000.0 })
  @IsNumber()
  @Min(0)
  importeNetoGravado: number;

  @ApiPropertyOptional({ description: 'Importe neto no gravado', example: 0 })
  @IsOptional()
  @IsNumber()
  importeNetoNoGravado?: number;

  @ApiPropertyOptional({ description: 'Importe exento', example: 0 })
  @IsOptional()
  @IsNumber()
  importeExento?: number;

  @ApiPropertyOptional({ description: 'Importe IVA total', example: 210.0 })
  @IsOptional()
  @IsNumber()
  importeIva?: number;

  @ApiPropertyOptional({ description: 'Importe de otros tributos', example: 0 })
  @IsOptional()
  @IsNumber()
  importeTributos?: number;

  @ApiProperty({ description: 'Importe total', example: 1210.0 })
  @IsNumber()
  @Min(0)
  importeTotal: number;

  // --- Moneda ---
  @ApiPropertyOptional({ description: 'Moneda (PES, DOL, EUR)', example: 'PES' })
  @IsOptional()
  @IsString()
  moneda?: string;

  @ApiPropertyOptional({ description: 'Cotización de la moneda', example: 1 })
  @IsOptional()
  @IsNumber()
  cotizacionMoneda?: number;

  // --- Servicio ---
  @ApiPropertyOptional({ description: 'Período desde (DD/MM/YYYY) - solo servicios', example: '01/12/2025' })
  @IsOptional()
  @IsString()
  periodoDesde?: string;

  @ApiPropertyOptional({ description: 'Período hasta (DD/MM/YYYY) - solo servicios', example: '31/12/2025' })
  @IsOptional()
  @IsString()
  periodoHasta?: string;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento del pago (DD/MM/YYYY)', example: '15/01/2026' })
  @IsOptional()
  @IsString()
  fechaVencimientoPago?: string;

  // --- Condición de venta ---
  @ApiPropertyOptional({ description: 'Condición de venta', example: 'Contado' })
  @IsOptional()
  @IsString()
  condicionVenta?: string;

  // --- Observaciones ---
  @ApiPropertyOptional({ description: 'Observaciones adicionales' })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
