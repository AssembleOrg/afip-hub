import { ApiProperty } from '@nestjs/swagger';

export class ObservacionDto {
  @ApiProperty({ description: 'Código de la observación', example: 10049 })
  code: number;

  @ApiProperty({ description: 'Mensaje de la observación', example: 'FchServDesde Debe informarse solo si Concepto es igual a 2 o 3.' })
  msg: string;
}

/**
 * Datos para generar el Código QR según RG 4291
 * https://www.afip.gob.ar/fe/qr/especificaciones.asp
 */
export class QrDataDto {
  @ApiProperty({ description: 'Versión del formato QR', example: 1 })
  ver: number;

  @ApiProperty({ description: 'Fecha de emisión (YYYY-MM-DD)', example: '2025-12-05' })
  fecha: string;

  @ApiProperty({ description: 'CUIT del emisor', example: '20123456789' })
  cuit: string;

  @ApiProperty({ description: 'Punto de venta', example: 1 })
  ptoVta: number;

  @ApiProperty({ description: 'Tipo de comprobante', example: 6 })
  tipoCmp: number;

  @ApiProperty({ description: 'Número de comprobante', example: 1 })
  nroCmp: number;

  @ApiProperty({ description: 'Importe total', example: 1210.0 })
  importe: number;

  @ApiProperty({ description: 'Moneda (PES, DOL, etc)', example: 'PES' })
  moneda: string;

  @ApiProperty({ description: 'Cotización de la moneda', example: 1 })
  ctz: number;

  @ApiProperty({ description: 'Tipo de documento del receptor', example: 80 })
  tipoDocRec: number;

  @ApiProperty({ description: 'Número de documento del receptor', example: '20123456789' })
  nroDocRec: string;

  @ApiProperty({ description: 'Tipo de código de autorización (E=CAE, A=CAEA)', example: 'E' })
  tipoCodAut: string;

  @ApiProperty({ description: 'Código de autorización (CAE/CAEA)', example: '71234567890123' })
  codAut: string;

  @ApiProperty({ description: 'URL para el QR (base64 encoded JSON)', example: 'https://www.afip.gob.ar/fe/qr/?p=...' })
  url: string;
}

export class InvoiceResponseDto {
  @ApiProperty({ description: 'Código de Autorización Electrónico', example: '71234567890123' })
  cae: string;

  @ApiProperty({ description: 'Fecha de vencimiento del CAE (YYYYMMDD)', example: '20251215' })
  caeFchVto: string;

  @ApiProperty({ description: 'Punto de venta', example: 1 })
  puntoVenta: number;

  @ApiProperty({ description: 'Tipo de comprobante', example: 6 })
  tipoComprobante: number;

  @ApiProperty({ description: 'Número de comprobante', example: 1 })
  numeroComprobante: number;

  @ApiProperty({ description: 'Fecha del comprobante (YYYYMMDD)', example: '20251205' })
  fechaComprobante: string;

  @ApiProperty({ description: 'Importe total', example: 1210.0 })
  importeTotal: number;

  @ApiProperty({ description: 'Resultado: A=Aprobado, R=Rechazado, P=Parcialmente aprobado', example: 'A' })
  resultado: string;

  @ApiProperty({ description: 'Código de autorización (alias de CAE)', required: false })
  codigoAutorizacion?: string;

  @ApiProperty({ type: [String], description: 'Observaciones en formato texto (legacy)', required: false })
  observaciones?: string[];

  @ApiProperty({ type: [ObservacionDto], description: 'Observaciones estructuradas con código y mensaje', required: false })
  observacionesDetalladas?: ObservacionDto[];

  @ApiProperty({ 
    type: QrDataDto, 
    description: 'Datos para generar el código QR según RG 4291',
    required: false 
  })
  qrData?: QrDataDto;

  @ApiProperty({ description: 'CUIT del emisor', required: false })
  cuitEmisor?: string;

  @ApiProperty({ description: 'Tipo de documento del receptor', required: false })
  tipoDocReceptor?: number;

  @ApiProperty({ description: 'Número de documento del receptor', required: false })
  nroDocReceptor?: string;
}
