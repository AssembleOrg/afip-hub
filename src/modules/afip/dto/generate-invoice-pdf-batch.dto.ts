import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { InvoicePdfEmisorDto } from './generate-invoice-pdf.dto';

export class InvoicePdfBatchItemDto {
  @ApiProperty({ description: 'Fecha de emisión (DD/MM/YYYY)', example: '06/02/2026' })
  @IsString()
  @IsNotEmpty()
  fechaEmision: string;

  @ApiProperty({ description: 'Número de comprobante', example: 40 })
  @IsNumber()
  @Min(1)
  numeroComprobante: number;

  @ApiProperty({ description: 'CAE', example: '86062809658297' })
  @IsString()
  @IsNotEmpty()
  cae: string;

  @ApiProperty({ description: 'Importe total', example: 35001.35 })
  @IsNumber()
  @Min(0)
  importeTotal: number;
}

export class GenerateInvoicePdfBatchDto {
  @ApiProperty({ description: 'Datos del emisor', type: InvoicePdfEmisorDto })
  @ValidateNested()
  @Type(() => InvoicePdfEmisorDto)
  emisor: InvoicePdfEmisorDto;

  @ApiProperty({ description: 'Tipo de comprobante', example: 'FACTURA C' })
  @IsString()
  @IsNotEmpty()
  tipoComprobante: string;

  @ApiProperty({ description: 'Letra del comprobante', example: 'C' })
  @IsString()
  @IsNotEmpty()
  letra: string;

  @ApiProperty({ description: 'Punto de venta', example: 2 })
  @IsNumber()
  @Min(1)
  puntoVenta: number;

  @ApiProperty({ description: 'Lista de facturas a generar', type: [InvoicePdfBatchItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoicePdfBatchItemDto)
  facturas: InvoicePdfBatchItemDto[];
}
