import { ApiProperty } from '@nestjs/swagger';

export class ObservacionDto {
  @ApiProperty({ description: 'Código de la observación', example: 10049 })
  code: number;

  @ApiProperty({ description: 'Mensaje de la observación', example: 'FchServDesde Debe informarse solo si Concepto es igual a 2 o 3.' })
  msg: string;
}

export class InvoiceResponseDto {
  @ApiProperty()
  cae: string;

  @ApiProperty()
  caeFchVto: string;

  @ApiProperty()
  puntoVenta: number;

  @ApiProperty()
  tipoComprobante: number;

  @ApiProperty()
  numeroComprobante: number;

  @ApiProperty()
  fechaComprobante: string;

  @ApiProperty()
  importeTotal: number;

  @ApiProperty({ description: 'Resultado: A=Aprobado, R=Rechazado, P=Parcialmente aprobado' })
  resultado: string;

  @ApiProperty()
  codigoAutorizacion?: string;

  @ApiProperty({ type: [String], description: 'Observaciones en formato texto (legacy)' })
  observaciones?: string[];

  @ApiProperty({ type: [ObservacionDto], description: 'Observaciones estructuradas con código y mensaje' })
  observacionesDetalladas?: ObservacionDto[];
}

