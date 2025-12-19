import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, Min, IsNotEmpty, IsBoolean } from 'class-validator';
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

