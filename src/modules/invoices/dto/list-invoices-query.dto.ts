import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ListInvoicesQueryDto {
  @ApiPropertyOptional({ description: 'CUIT emisor (con o sin guiones)' })
  @IsOptional()
  @IsString()
  cuitEmisor?: string;

  @ApiPropertyOptional({ description: 'Punto de venta' })
  @IsOptional()
  @IsInt()
  @Min(1)
  puntoVenta?: number;

  @ApiPropertyOptional({ description: 'Tipo de comprobante AFIP' })
  @IsOptional()
  @IsInt()
  @Min(1)
  tipoComprobante?: number;

  @ApiPropertyOptional({ description: 'Fecha desde (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ description: 'Offset de paginación', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({
    description: 'Cantidad máxima (cap 200 en server)',
    default: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @ApiPropertyOptional({ description: 'Número de página (base 1)', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Tamaño de página', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
