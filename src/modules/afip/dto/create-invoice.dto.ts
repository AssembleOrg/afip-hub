import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional, IsEnum, Min, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/**
 * Tipos de Comprobante según AFIP
 * Referencia: Manual ARCA-COMPG v4.0 - Tabla de Tipos de Comprobante
 */
export enum TipoComprobante {
  // Facturas
  FACTURA_A = 1,
  FACTURA_B = 6,
  FACTURA_C = 11,
  
  // Notas de Débito
  NOTA_DEBITO_A = 2,
  NOTA_DEBITO_B = 7,
  NOTA_DEBITO_C = 12,
  
  // Notas de Crédito
  NOTA_CREDITO_A = 3,
  NOTA_CREDITO_B = 8,
  NOTA_CREDITO_C = 13,
  
  // Recibos
  RECIBO_A = 4,
  RECIBO_B = 9,
  RECIBO_C = 15,
  
  // Facturas de Crédito Electrónica (MiPyME)
  FACTURA_CREDITO_ELECTRONICA_A = 201,
  FACTURA_CREDITO_ELECTRONICA_B = 206,
  FACTURA_CREDITO_ELECTRONICA_C = 211,
  
  // Notas de Débito de Crédito Electrónica (MiPyME)
  NOTA_DEBITO_CREDITO_ELECTRONICA_A = 202,
  NOTA_DEBITO_CREDITO_ELECTRONICA_B = 207,
  NOTA_DEBITO_CREDITO_ELECTRONICA_C = 212,
  
  // Notas de Crédito de Crédito Electrónica (MiPyME)
  NOTA_CREDITO_CREDITO_ELECTRONICA_A = 203,
  NOTA_CREDITO_CREDITO_ELECTRONICA_B = 208,
  NOTA_CREDITO_CREDITO_ELECTRONICA_C = 213,
  
  // Facturas M (operaciones sujetas a retención)
  FACTURA_M = 51,
  NOTA_DEBITO_M = 52,
  NOTA_CREDITO_M = 53,
}

/**
 * Tipo de Documento del receptor
 */
export enum TipoDocumento {
  CUIT = 80,
  CUIL = 86,
  CDI = 87,        // Clave de Identificación
  DNI = 96,
  PASAPORTE = 94,
  CI_EXTRANJERA = 91,
  EN_TRAMITE = 90,
  CONSUMIDOR_FINAL = 99, // Sin identificación (Consumidor Final)
}

/**
 * Condición frente al IVA del receptor
 * Según Manual ARCA-COMPG v4.0 - FEParamGetCondicionIvaReceptor
 * 
 * IMPORTANTE: Desde 01/02/2026 será OBLIGATORIO enviar este campo
 * 
 * Combinaciones válidas por clase de comprobante:
 * - Clase A/M: 1, 6, 13, 16
 * - Clase B: 4, 5, 7, 8, 9, 10, 15
 * - Clase C: 1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16
 */
export enum CondicionIvaReceptor {
  IVA_RESPONSABLE_INSCRIPTO = 1,
  IVA_SUJETO_EXENTO = 4,
  CONSUMIDOR_FINAL = 5,
  RESPONSABLE_MONOTRIBUTO = 6,
  SUJETO_NO_CATEGORIZADO = 7,
  PROVEEDOR_EXTERIOR = 8,
  CLIENTE_EXTERIOR = 9,
  IVA_LIBERADO = 10,           // Ley Nº 19.640
  MONOTRIBUTISTA_SOCIAL = 13,
  IVA_NO_ALCANZADO = 15,
  MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO = 16,
}

/**
 * Concepto de la operación
 */
export enum Concepto {
  PRODUCTOS = 1,
  SERVICIOS = 2,
  PRODUCTOS_Y_SERVICIOS = 3,
}

/**
 * Alícuotas de IVA según AFIP
 */
export enum AlicuotaIva {
  NO_GRAVADO = 1,
  EXENTO = 2,
  IVA_0 = 3,
  IVA_10_5 = 4,
  IVA_21 = 5,
  IVA_27 = 6,
  IVA_5 = 8,
  IVA_2_5 = 9,
}

/**
 * Detalle de alícuota de IVA
 * Requerido para Facturas A, B, M cuando hay IVA
 */
export class IvaDto {
  @ApiProperty({ 
    description: 'Código de alícuota de IVA',
    enum: AlicuotaIva,
    example: AlicuotaIva.IVA_21
  })
  @IsNumber()
  Id: number;

  @ApiProperty({ description: 'Base imponible para esta alícuota', example: 1000.0 })
  @IsNumber()
  @Min(0)
  BaseImp: number;

  @ApiProperty({ description: 'Importe del IVA', example: 210.0 })
  @IsNumber()
  @Min(0)
  Importe: number;
}

/**
 * Comprobante asociado (requerido para Notas de Crédito/Débito)
 */
export class ComprobanteAsociadoDto {
  @ApiProperty({ 
    description: 'Tipo de comprobante asociado',
    enum: TipoComprobante,
    example: TipoComprobante.FACTURA_A
  })
  @IsNumber()
  Tipo: number;

  @ApiProperty({ description: 'Punto de venta del comprobante asociado', example: 1 })
  @IsNumber()
  @Min(1)
  PtoVta: number;

  @ApiProperty({ description: 'Número del comprobante asociado', example: 1 })
  @IsNumber()
  @Min(1)
  Nro: number;

  @ApiProperty({ description: 'CUIT del emisor del comprobante asociado (opcional)', required: false })
  @IsOptional()
  @IsString()
  Cuit?: string;

  @ApiProperty({ description: 'Fecha del comprobante asociado (YYYYMMDD)', example: '20251201' })
  @IsString()
  @IsNotEmpty()
  CbteFch: string;
}

/**
 * Datos para CBU (Facturas de Crédito Electrónica MiPyME)
 */
export class CbuDto {
  @ApiProperty({ description: 'CBU del emisor', example: '0110599940000064179016' })
  @IsString()
  @IsNotEmpty()
  Cbu: string;

  @ApiProperty({ description: 'Alias del CBU (opcional)', required: false })
  @IsOptional()
  @IsString()
  Alias?: string;
}

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Punto de venta', example: 1 })
  @IsNumber()
  @Min(1)
  puntoVenta: number;

  @ApiProperty({ 
    description: 'Tipo de comprobante',
    enum: TipoComprobante,
    example: TipoComprobante.FACTURA_B
  })
  @IsEnum(TipoComprobante)
  tipoComprobante: TipoComprobante;

  @ApiProperty({ 
    description: 'Número de comprobante. Si es 0 o no se envía, se obtiene automáticamente', 
    example: 1,
    required: false 
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  numeroComprobante?: number;

  @ApiProperty({ description: 'Fecha del comprobante (YYYYMMDD)', example: '20251205' })
  @IsString()
  @IsNotEmpty()
  fechaComprobante: string;

  @ApiProperty({ description: 'CUIT/CUIL/DNI del cliente (sin guiones)', example: '20123456789' })
  @IsString()
  @IsNotEmpty()
  cuitCliente: string;

  @ApiProperty({ 
    description: 'Tipo de documento del cliente',
    enum: TipoDocumento,
    example: TipoDocumento.CUIT
  })
  @IsEnum(TipoDocumento)
  tipoDocumento: TipoDocumento;

  @ApiProperty({ 
    description: 'Condición frente al IVA del receptor (obligatorio desde 01/02/2026). Ver enum CondicionIvaReceptor para valores válidos según clase de comprobante.',
    enum: CondicionIvaReceptor,
    example: CondicionIvaReceptor.CONSUMIDOR_FINAL,
    required: false
  })
  @IsOptional()
  @IsEnum(CondicionIvaReceptor)
  condicionIvaReceptor?: CondicionIvaReceptor;

  @ApiProperty({ 
    description: 'Concepto de la operación',
    enum: Concepto,
    example: Concepto.PRODUCTOS
  })
  @IsEnum(Concepto)
  concepto: Concepto;

  @ApiProperty({ description: 'Importe neto gravado (base imponible)', example: 1000.0 })
  @IsNumber()
  @Min(0)
  importeNetoGravado: number;

  @ApiProperty({ description: 'Importe neto no gravado', example: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeNetoNoGravado?: number;

  @ApiProperty({ description: 'Importe exento', example: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeExento?: number;

  @ApiProperty({ description: 'Importe IVA total', example: 210.0 })
  @IsNumber()
  @Min(0)
  importeIva: number;

  @ApiProperty({ description: 'Importe de tributos adicionales', example: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeTributos?: number;

  @ApiProperty({ description: 'Importe total del comprobante', example: 1210.0 })
  @IsNumber()
  @Min(0)
  importeTotal: number;

  @ApiProperty({ 
    description: 'Importe de descuento/bonificación',
    example: 0,
    required: false
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  importeDescuento?: number;

  @ApiProperty({ 
    description: 'Detalle de alícuotas de IVA (requerido para Factura A, B, M cuando ImpIVA > 0)',
    type: [IvaDto],
    required: false
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IvaDto)
  iva?: IvaDto[];

  @ApiProperty({ 
    description: 'Comprobantes asociados (requerido para Notas de Crédito/Débito)',
    type: [ComprobanteAsociadoDto],
    required: false
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComprobanteAsociadoDto)
  comprobantesAsociados?: ComprobanteAsociadoDto[];

  @ApiProperty({ description: 'Moneda ID (PES = Pesos, DOL = Dólares, EUR = Euros)', example: 'PES', required: false })
  @IsOptional()
  @IsString()
  monedaId?: string;

  @ApiProperty({ description: 'Cotización de la moneda (1 para PES)', example: 1, required: false })
  @IsOptional()
  @IsNumber()
  cotizacionMoneda?: number;

  // Campos para Servicios (Concepto 2 o 3)
  @ApiProperty({ description: 'Fecha desde del servicio (YYYYMMDD) - Solo para Concepto 2 o 3', required: false })
  @IsOptional()
  @IsString()
  fechaServicioDesde?: string;

  @ApiProperty({ description: 'Fecha hasta del servicio (YYYYMMDD) - Solo para Concepto 2 o 3', required: false })
  @IsOptional()
  @IsString()
  fechaServicioHasta?: string;

  @ApiProperty({ description: 'Fecha de vencimiento del pago (YYYYMMDD) - Solo para Concepto 2 o 3', required: false })
  @IsOptional()
  @IsString()
  fechaVencimientoPago?: string;

  // Campos para Facturas de Crédito Electrónica MiPyME
  @ApiProperty({ 
    description: 'Datos del CBU (requerido para Facturas de Crédito Electrónica)',
    type: CbuDto,
    required: false
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CbuDto)
  cbu?: CbuDto;

  @ApiProperty({ 
    description: 'Fecha de vencimiento del pago para FCE (YYYYMMDD)',
    required: false
  })
  @IsOptional()
  @IsString()
  fceVtoPago?: string;

  // Credenciales del emisor
  @ApiProperty({ 
    description: 'CUIT del emisor de la factura (sin guiones)', 
    example: '20123456789',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  cuitEmisor: string;

  @ApiProperty({ 
    description: 'Certificado digital (.crt) en formato PEM',
    example: '-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAK...\n-----END CERTIFICATE-----',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  certificado: string;

  @ApiProperty({ 
    description: 'Clave privada (.key) en formato PEM',
    example: '-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG...\n-----END RSA PRIVATE KEY-----',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  clavePrivada: string;

  @ApiPropertyOptional({ 
    description: 'Usar entorno de homologación (true) o producción (false). Default: true (homologación)',
    example: true,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true || value === undefined || value === null)
  homologacion?: boolean;
}

/**
 * Utilidades para determinar la clase de comprobante
 */
export function getClaseComprobante(tipoComprobante: number): 'A' | 'B' | 'C' | 'M' | 'FCE_A' | 'FCE_B' | 'FCE_C' {
  const claseMap: Record<number, 'A' | 'B' | 'C' | 'M' | 'FCE_A' | 'FCE_B' | 'FCE_C'> = {
    // Clase A
    1: 'A', 2: 'A', 3: 'A', 4: 'A',
    // Clase B
    6: 'B', 7: 'B', 8: 'B', 9: 'B',
    // Clase C
    11: 'C', 12: 'C', 13: 'C', 15: 'C',
    // Clase M
    51: 'M', 52: 'M', 53: 'M',
    // FCE A
    201: 'FCE_A', 202: 'FCE_A', 203: 'FCE_A',
    // FCE B
    206: 'FCE_B', 207: 'FCE_B', 208: 'FCE_B',
    // FCE C
    211: 'FCE_C', 212: 'FCE_C', 213: 'FCE_C',
  };
  return claseMap[tipoComprobante] || 'C';
}

/**
 * Verifica si un tipo de comprobante es Nota de Crédito o Débito
 */
export function esNotaCreditoDebito(tipoComprobante: number): boolean {
  const notasCreditoDebito = [2, 3, 7, 8, 12, 13, 52, 53, 202, 203, 207, 208, 212, 213];
  return notasCreditoDebito.includes(tipoComprobante);
}

/**
 * Verifica si es Factura de Crédito Electrónica
 */
export function esFacturaCreditoElectronica(tipoComprobante: number): boolean {
  return tipoComprobante >= 201 && tipoComprobante <= 213;
}

/**
 * Obtiene las condiciones IVA válidas para una clase de comprobante
 */
export function getCondicionesIvaValidas(clase: string): number[] {
  const condicionesMap: Record<string, number[]> = {
    'A': [1, 6, 13, 16],
    'M': [1, 6, 13, 16],
    'B': [4, 5, 7, 8, 9, 10, 15],
    'C': [1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16],
    'FCE_A': [1, 6, 13, 16],
    'FCE_B': [4, 5, 7, 8, 9, 10, 15],
    'FCE_C': [1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16],
  };
  return condicionesMap[clase] || [];
}
