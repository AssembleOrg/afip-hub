import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsBoolean, Min, Max, ValidateNested } from 'class-validator';
import { Type, Transform } from 'class-transformer';

// ============================================
// REQUEST DTOs
// ============================================

/**
 * DTO base con credenciales AFIP para Ventanilla Electrónica
 */
export class VeBaseRequestDto {
  @ApiProperty({ description: 'CUIT del contribuyente (11 dígitos)', example: '20123456789' })
  @IsString()
  cuitRepresentada: string;

  @ApiProperty({ description: 'Certificado digital en formato PEM o base64' })
  @IsString()
  certificado: string;

  @ApiProperty({ description: 'Clave privada en formato PEM o base64' })
  @IsString()
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
 * Filtros para consultar comunicaciones
 */
export class VeComunicacionesFilterDto {
  @ApiPropertyOptional({ 
    description: 'Estado de la comunicación (1=No leída, 2=Leída)', 
    example: 1,
    enum: [1, 2]
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  estado?: number;

  @ApiPropertyOptional({ 
    description: 'Fecha límite inferior (YYYY-MM-DD)', 
    example: '2025-01-01' 
  })
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional({ 
    description: 'Fecha límite superior (YYYY-MM-DD)', 
    example: '2025-12-31' 
  })
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ 
    description: 'ID del sistema publicador', 
    example: 88 
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  idSistemaPublicador?: number;

  @ApiPropertyOptional({ 
    description: 'ID de comunicación desde', 
    example: 1 
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  idComunicacionDesde?: number;

  @ApiPropertyOptional({ 
    description: 'ID de comunicación hasta', 
    example: 100 
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  idComunicacionHasta?: number;
}

/**
 * DTO para consultar comunicaciones
 */
export class ConsultarComunicacionesDto extends VeBaseRequestDto {
  @ApiPropertyOptional({ description: 'Filtros de búsqueda' })
  @IsOptional()
  @ValidateNested()
  @Type(() => VeComunicacionesFilterDto)
  filtros?: VeComunicacionesFilterDto;

  @ApiPropertyOptional({ 
    description: 'Número de página (1-based)', 
    example: 1, 
    default: 1 
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  pagina?: number;

  @ApiPropertyOptional({ 
    description: 'Items por página (máx 50)', 
    example: 20, 
    default: 20 
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  itemsPorPagina?: number;
}

/**
 * DTO para consumir/leer una comunicación específica
 */
export class ConsumirComunicacionDto extends VeBaseRequestDto {
  @ApiProperty({ 
    description: 'ID de la comunicación a leer', 
    example: 12345678 
  })
  @IsNumber()
  @Type(() => Number)
  idComunicacion: number;

  @ApiPropertyOptional({ 
    description: 'Incluir adjuntos en la respuesta', 
    default: false 
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  incluirAdjuntos?: boolean;
}

/**
 * DTO para consultar sistemas publicadores
 */
export class ConsultarSistemasPublicadoresDto extends VeBaseRequestDto {
  @ApiPropertyOptional({ 
    description: 'ID específico del sistema publicador (opcional)', 
    example: 88 
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  idSistemaPublicador?: number;
}

/**
 * DTO para consultar estados
 */
export class ConsultarEstadosDto extends VeBaseRequestDto {}

// ============================================
// RESPONSE DTOs
// ============================================

/**
 * Comunicación individual
 */
export class ComunicacionDto {
  @ApiProperty({ description: 'ID único de la comunicación', example: 12345678 })
  idComunicacion: number;

  @ApiProperty({ description: 'CUIT del destinatario', example: '20123456789' })
  cuitDestinatario: string;

  @ApiProperty({ description: 'Fecha de publicación', example: '2025-01-15' })
  fechaPublicacion: string;

  @ApiPropertyOptional({ description: 'Fecha de vencimiento', example: '2025-02-15' })
  fechaVencimiento?: string;

  @ApiProperty({ description: 'ID del sistema publicador', example: 88 })
  sistemaPublicador: number;

  @ApiProperty({ description: 'Descripción del sistema publicador', example: 'ARCA - Facturación' })
  sistemaPublicadorDesc: string;

  @ApiProperty({ description: 'Estado (1=No leída, 2=Leída)', example: 1 })
  estado: number;

  @ApiProperty({ description: 'Descripción del estado', example: 'No leída' })
  estadoDesc: string;

  @ApiProperty({ description: 'Asunto de la comunicación', example: 'Notificación importante' })
  asunto: string;

  @ApiPropertyOptional({ description: 'Prioridad', example: 1 })
  prioridad?: number;

  @ApiProperty({ description: 'Indica si tiene adjuntos', example: false })
  tieneAdjunto: boolean;

  @ApiPropertyOptional({ description: 'Referencia adicional 1' })
  referencia1?: string;

  @ApiPropertyOptional({ description: 'Referencia adicional 2' })
  referencia2?: string;
}

/**
 * Paginación de respuesta
 */
export class PaginacionDto {
  @ApiProperty({ description: 'Página actual', example: 1 })
  pagina: number;

  @ApiProperty({ description: 'Total de páginas', example: 5 })
  totalPaginas: number;

  @ApiProperty({ description: 'Items por página', example: 20 })
  itemsPorPagina: number;

  @ApiProperty({ description: 'Total de items encontrados', example: 100 })
  totalItems: number;
}

/**
 * Respuesta de consultar comunicaciones
 */
export class ComunicacionesPaginadasResponseDto {
  @ApiProperty({ type: PaginacionDto })
  paginacion: PaginacionDto;

  @ApiProperty({ type: [ComunicacionDto] })
  comunicaciones: ComunicacionDto[];
}

/**
 * Adjunto de comunicación
 */
export class AdjuntoDto {
  @ApiProperty({ description: 'Nombre del archivo', example: 'documento.pdf' })
  nombre: string;

  @ApiProperty({ description: 'Tipo MIME', example: 'application/pdf' })
  tipoMime: string;

  @ApiPropertyOptional({ description: 'Contenido en base64 (si se solicitó)' })
  contenidoBase64?: string;

  @ApiPropertyOptional({ description: 'Tamaño en bytes' })
  tamanio?: number;
}

/**
 * Respuesta de consumir comunicación
 */
export class ComunicacionDetalleResponseDto extends ComunicacionDto {
  @ApiPropertyOptional({ description: 'Cuerpo/mensaje de la comunicación' })
  cuerpo?: string;

  @ApiPropertyOptional({ type: [AdjuntoDto], description: 'Lista de adjuntos' })
  adjuntos?: AdjuntoDto[];

  @ApiPropertyOptional({ description: 'Fecha de lectura' })
  fechaLectura?: string;
}

/**
 * Sistema publicador
 */
export class SistemaPublicadorDto {
  @ApiProperty({ description: 'ID del sistema', example: 88 })
  id: number;

  @ApiProperty({ description: 'Descripción del sistema', example: 'ARCA - Facturación' })
  descripcion: string;

  @ApiPropertyOptional({ description: 'Common Name del certificado' })
  certCN?: string;

  @ApiPropertyOptional({ description: 'Subservicios disponibles' })
  subservicios?: string[];
}

/**
 * Respuesta de consultar sistemas publicadores
 */
export class SistemasPublicadoresResponseDto {
  @ApiProperty({ type: [SistemaPublicadorDto] })
  sistemas: SistemaPublicadorDto[];
}

/**
 * Estado de comunicación
 */
export class EstadoComunicacionDto {
  @ApiProperty({ description: 'Código del estado', example: 1 })
  codigo: number;

  @ApiProperty({ description: 'Descripción del estado', example: 'No leída' })
  descripcion: string;
}

/**
 * Respuesta de consultar estados
 */
export class EstadosComunicacionResponseDto {
  @ApiProperty({ type: [EstadoComunicacionDto] })
  estados: EstadoComunicacionDto[];
}

