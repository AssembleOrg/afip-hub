import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

// ============================================
// REQUEST DTOs
// ============================================

/**
 * DTO base con credenciales AFIP para WSCDC
 */
export class WscdcBaseRequestDto {
  @ApiProperty({ 
    description: 'CUIT del emisor (11 dígitos)', 
    example: '20123456789' 
  })
  @IsString()
  @IsNotEmpty()
  cuitEmisor: string;

  @ApiProperty({ 
    description: 'Certificado digital en formato PEM o base64' 
  })
  @IsString()
  @IsNotEmpty()
  certificado: string;

  @ApiProperty({ 
    description: 'Clave privada en formato PEM o base64' 
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
 * DTO para constatar/verificar un comprobante
 */
export class ComprobanteConstatarDto extends WscdcBaseRequestDto {
  @ApiProperty({ 
    description: 'Punto de venta', 
    example: 1 
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  puntoVenta: number;

  @ApiProperty({ 
    description: 'Tipo de comprobante', 
    example: 6 
  })
  @IsNumber()
  @Type(() => Number)
  tipoComprobante: number;

  @ApiProperty({ 
    description: 'Número de comprobante', 
    example: 1 
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  numeroComprobante: number;

  @ApiPropertyOptional({ 
    description: 'CUIT del emisor del comprobante (opcional, para verificar comprobantes de terceros)', 
    example: '20123456789' 
  })
  @IsOptional()
  @IsString()
  cuitEmisorComprobante?: string;
}

/**
 * DTO para consultar modalidades de comprobante
 */
export class ComprobantesModalidadConsultarDto extends WscdcBaseRequestDto {}

/**
 * DTO para consultar tipos de comprobante
 */
export class ComprobantesTipoConsultarDto extends WscdcBaseRequestDto {}

/**
 * DTO para consultar tipos de documento
 */
export class DocumentosTipoConsultarDto extends WscdcBaseRequestDto {}

/**
 * DTO para consultar tipos de datos opcionales
 */
export class OpcionalesTipoConsultarDto extends WscdcBaseRequestDto {}

/**
 * DTO para método Dummy (no requiere autenticación)
 */
export class ComprobanteDummyDto {
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

// ============================================
// RESPONSE DTOs
// ============================================

/**
 * Error o evento de respuesta
 */
export class ErrorEventDto {
  @ApiProperty({ description: 'Código de error/evento', example: 500 })
  code: number;

  @ApiProperty({ description: 'Mensaje descriptivo', example: 'Error interno de aplicación' })
  msg: string;
}

/**
 * Respuesta de constatación de comprobante
 */
export class ComprobanteConstatarResponseDto {
  @ApiProperty({ 
    description: 'Resultado: A=Aprobado, R=Rechazado, P=Parcialmente aprobado', 
    example: 'A' 
  })
  resultado: string;

  @ApiPropertyOptional({ 
    description: 'Código de autorización (CAE/CAEA)', 
    example: '71234567890123' 
  })
  codigoAutorizacion?: string;

  @ApiPropertyOptional({ 
    description: 'Fecha de emisión (YYYYMMDD)', 
    example: '20251205' 
  })
  fechaEmision?: string;

  @ApiPropertyOptional({ 
    description: 'Fecha de vencimiento (YYYYMMDD)', 
    example: '20251215' 
  })
  fechaVencimiento?: string;

  @ApiPropertyOptional({ 
    description: 'Importe total del comprobante', 
    example: 1210.0 
  })
  importeTotal?: number;

  @ApiPropertyOptional({ 
    description: 'Estado del comprobante (Autorizado, Rendido, Anulado)', 
    example: 'Autorizado' 
  })
  estado?: string;

  @ApiProperty({ description: 'Punto de venta', example: 1 })
  puntoVenta: number;

  @ApiProperty({ description: 'Tipo de comprobante', example: 6 })
  tipoComprobante: number;

  @ApiProperty({ description: 'Número de comprobante', example: 1 })
  numeroComprobante: number;

  @ApiProperty({ description: 'CUIT del emisor', example: '20123456789' })
  cuitEmisor: string;

  @ApiPropertyOptional({ description: 'CUIT del receptor', example: '30123456789' })
  cuitReceptor?: string;

  @ApiPropertyOptional({ 
    type: [ErrorEventDto], 
    description: 'Errores detectados' 
  })
  errors?: ErrorEventDto[];

  @ApiPropertyOptional({ 
    type: [ErrorEventDto], 
    description: 'Eventos informativos' 
  })
  events?: ErrorEventDto[];
}

/**
 * Item de modalidad de comprobante
 */
export class ModalidadItemDto {
  @ApiProperty({ description: 'ID de la modalidad', example: 1 })
  Id: number;

  @ApiProperty({ description: 'Descripción de la modalidad', example: 'CAE' })
  Desc: string;

  @ApiProperty({ description: 'Fecha de vigencia desde (YYYYMMDD)', example: '20200101' })
  FchDesde: string;

  @ApiPropertyOptional({ description: 'Fecha de vigencia hasta (YYYYMMDD)', example: '20251231' })
  FchHasta?: string;
}

/**
 * Respuesta de modalidades de comprobante
 */
export class ModalidadResponseDto {
  @ApiProperty({ type: [ModalidadItemDto] })
  modalidades: ModalidadItemDto[];

  @ApiPropertyOptional({ type: [ErrorEventDto] })
  errors?: ErrorEventDto[];

  @ApiPropertyOptional({ type: [ErrorEventDto] })
  events?: ErrorEventDto[];
}

/**
 * Item de tipo de comprobante
 */
export class TipoComprobanteWscdcItemDto {
  @ApiProperty({ description: 'ID del tipo de comprobante', example: 1 })
  Id: number;

  @ApiProperty({ description: 'Descripción del tipo', example: 'Factura A' })
  Desc: string;

  @ApiProperty({ description: 'Fecha de vigencia desde (YYYYMMDD)', example: '20200101' })
  FchDesde: string;

  @ApiPropertyOptional({ description: 'Fecha de vigencia hasta (YYYYMMDD)', example: '20251231' })
  FchHasta?: string;
}

/**
 * Respuesta de tipos de comprobante
 */
export class TipoComprobanteWscdcResponseDto {
  @ApiProperty({ type: [TipoComprobanteWscdcItemDto] })
  tipos: TipoComprobanteWscdcItemDto[];

  @ApiPropertyOptional({ type: [ErrorEventDto] })
  errors?: ErrorEventDto[];

  @ApiPropertyOptional({ type: [ErrorEventDto] })
  events?: ErrorEventDto[];
}

/**
 * Item de tipo de documento
 */
export class TipoDocumentoItemDto {
  @ApiProperty({ description: 'ID del tipo de documento', example: 80 })
  Id: number;

  @ApiProperty({ description: 'Descripción del tipo', example: 'CUIT' })
  Desc: string;

  @ApiProperty({ description: 'Fecha de vigencia desde (YYYYMMDD)', example: '20200101' })
  FchDesde: string;

  @ApiPropertyOptional({ description: 'Fecha de vigencia hasta (YYYYMMDD)', example: '20251231' })
  FchHasta?: string;
}

/**
 * Respuesta de tipos de documento
 */
export class TipoDocumentoResponseDto {
  @ApiProperty({ type: [TipoDocumentoItemDto] })
  tipos: TipoDocumentoItemDto[];

  @ApiPropertyOptional({ type: [ErrorEventDto] })
  errors?: ErrorEventDto[];

  @ApiPropertyOptional({ type: [ErrorEventDto] })
  events?: ErrorEventDto[];
}

/**
 * Item de tipo de dato opcional
 */
export class TipoOpcionalItemDto {
  @ApiProperty({ description: 'ID del tipo opcional', example: '2101' })
  Id: string;

  @ApiProperty({ description: 'Descripción del tipo', example: 'CBU' })
  Desc: string;

  @ApiProperty({ description: 'Fecha de vigencia desde (YYYYMMDD)', example: '20200101' })
  FchDesde: string;

  @ApiPropertyOptional({ description: 'Fecha de vigencia hasta (YYYYMMDD)', example: '20251231' })
  FchHasta?: string;
}

/**
 * Respuesta de tipos de datos opcionales
 */
export class TipoOpcionalResponseDto {
  @ApiProperty({ type: [TipoOpcionalItemDto] })
  tipos: TipoOpcionalItemDto[];

  @ApiPropertyOptional({ type: [ErrorEventDto] })
  errors?: ErrorEventDto[];

  @ApiPropertyOptional({ type: [ErrorEventDto] })
  events?: ErrorEventDto[];
}

/**
 * Respuesta del método Dummy
 */
export class DummyResponseDto {
  @ApiProperty({ description: 'Servidor de aplicaciones', example: '01' })
  appServer: string;

  @ApiProperty({ description: 'Servidor de base de datos', example: '01' })
  dbServer: string;

  @ApiProperty({ description: 'Servidor de autenticación', example: '01' })
  authServer: string;
}

// ============================================
// V2 — Constatación COMPLETA (ComprobanteConstatar real)
// ============================================

export enum CbteModo {
  CAE = 'CAE',
  CAI = 'CAI',
  CAEA = 'CAEA',
}

export class OpcionalWscdcDto {
  @ApiProperty({ description: 'ID del campo opcional', example: '95' })
  @IsString()
  opcionalId: string;

  @ApiProperty({ description: 'Valor asociado', example: 'XYZ' })
  @IsString()
  valor: string;
}

/**
 * Request completo del método `ComprobanteConstatar` del WSCDC.
 * Incluye TODOS los campos obligatorios según la doc ARCA + validación
 * cruzada de `DocTipoReceptor`/`DocNroReceptor` según tipo e importe.
 */
export class ConstatarComprobanteCompletoDto extends WscdcBaseRequestDto {
  @ApiProperty({
    enum: CbteModo,
    example: CbteModo.CAE,
    description: 'Modo de autorización: CAE, CAI o CAEA',
  })
  @IsEnum(CbteModo)
  cbteModo: CbteModo;

  @ApiProperty({
    description: 'CUIT del emisor del comprobante a constatar (11 dígitos)',
    example: '30123456789',
  })
  @IsString()
  @Matches(/^\d{11}$/)
  cuitEmisorComprobante: string;

  @ApiProperty({ description: 'Punto de venta (1-99998)', example: 1 })
  @IsInt()
  @Min(1)
  @Max(99998)
  puntoVenta: number;

  @ApiProperty({ description: 'Tipo de comprobante (ver tabla AFIP)', example: 6 })
  @IsInt()
  tipoComprobante: number;

  @ApiProperty({
    description: 'Número de comprobante (1-99999999)',
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Max(99999999)
  numeroComprobante: number;

  @ApiProperty({
    description: 'Fecha del comprobante en formato YYYYMMDD',
    example: '20260420',
  })
  @IsString()
  @Matches(/^\d{8}$/)
  fechaComprobante: string;

  @ApiProperty({
    description:
      'Importe total a validar. Margen AFIP: error absoluto ≤ 1 o error relativo ≤ 0.01%.',
    example: 1210.0,
  })
  @IsNumber()
  @Min(0)
  importeTotal: number;

  @ApiProperty({
    description: 'Código de autorización (CAE/CAI/CAEA, 14 dígitos)',
    example: '71234567890123',
  })
  @IsString()
  @Matches(/^\d{14}$/, { message: 'codAutorizacion debe tener exactamente 14 dígitos' })
  codAutorizacion: string;

  /**
   * Tipo de documento del receptor. Obligatorio para:
   *  - Factura A y A con leyenda → SIEMPRE y debe ser 80 (CUIT)
   *  - MiPyme → SIEMPRE y debe ser 80
   *  - B/C/R/30/31/37/38/41/49 con ImpTotal > 10.000.000
   *  - T (195/196/197) → solo 80, 91, 94, 96
   */
  @ApiPropertyOptional({
    description:
      'Tipo documento receptor. Obligatorio para Factura A (=80), MiPyme (=80), y B/C si importe > 10MM. Si mandás DocNroReceptor, también tenés que mandar éste (error 117 si no).',
    example: '80',
  })
  @ValidateIf(
    (o: ConstatarComprobanteCompletoDto) =>
      !!o.docNroReceptor ||
      requiereReceptor(o.tipoComprobante, o.importeTotal),
  )
  @IsString()
  @Matches(/^\d{1,2}$/)
  docTipoReceptor?: string;

  @ApiPropertyOptional({
    description: 'Número documento receptor. Obligatorio junto con DocTipoReceptor.',
    example: '30999999998',
  })
  @ValidateIf(
    (o: ConstatarComprobanteCompletoDto) =>
      !!o.docTipoReceptor ||
      requiereReceptor(o.tipoComprobante, o.importeTotal),
  )
  @IsString()
  @Matches(/^\d{1,20}$/)
  docNroReceptor?: string;

  @ApiPropertyOptional({
    description: 'Campos opcionales (uso futuro, normalmente vacío)',
    type: [OpcionalWscdcDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OpcionalWscdcDto)
  @ArrayMaxSize(10)
  opcionales?: OpcionalWscdcDto[];
}

/** Tipos de comprobante clase A (incluye facturas, ND, NC, recibos A y MiPyme A). */
const TIPOS_A = new Set([1, 2, 3, 4, 201, 202, 203]);
/** Tipos MiPyme (Factura de Crédito Electrónica). */
const TIPOS_MIPYME = new Set([201, 202, 203, 206, 207, 208, 211, 212, 213]);
/** Tipos B/C/R que requieren receptor si importe > 10MM. */
const TIPOS_BC_RELEVANTES = new Set([6, 7, 8, 9, 11, 12, 13, 15, 4, 30, 31, 37, 38, 41, 49]);
const IMPORTE_TRIGGER_RECEPTOR = 10_000_000;

export function requiereReceptor(
  tipoComprobante: number | undefined,
  importeTotal: number | undefined,
): boolean {
  if (!tipoComprobante) return false;
  if (TIPOS_A.has(tipoComprobante)) return true;
  if (TIPOS_MIPYME.has(tipoComprobante)) return true;
  if (
    TIPOS_BC_RELEVANTES.has(tipoComprobante) &&
    (importeTotal ?? 0) > IMPORTE_TRIGGER_RECEPTOR
  ) {
    return true;
  }
  return false;
}

// ── Response V2 ─────────────────────────────────────────────────────────────

export enum ResultadoConstatacion {
  APROBADO = 'APROBADO',
  APROBADO_CON_OBSERVACIONES = 'APROBADO_CON_OBSERVACIONES',
  RECHAZADO = 'RECHAZADO',
}

export class ConstatarComprobanteCompletoResponseDto {
  @ApiProperty({ enum: ResultadoConstatacion })
  resultado: ResultadoConstatacion;

  @ApiProperty({ description: 'Valor crudo devuelto por AFIP (A o R)', example: 'A' })
  resultadoAfip: string;

  @ApiPropertyOptional({
    description: 'Timestamp AFIP del proceso, formato YYYYMMDDHHMMSS',
    example: '20260420154321',
  })
  fchProceso?: string;

  @ApiProperty({ type: [ErrorEventDto] })
  observaciones: ErrorEventDto[];

  @ApiProperty({ type: [ErrorEventDto] })
  errors: ErrorEventDto[];

  @ApiProperty({ type: [ErrorEventDto] })
  events: ErrorEventDto[];

  @ApiPropertyOptional({
    description: 'Resumen legible del estado para el user final',
    example: 'Comprobante válido y registrado',
  })
  mensaje?: string;
}

