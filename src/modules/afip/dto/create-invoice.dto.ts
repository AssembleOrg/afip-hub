import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';

export enum TipoComprobante {
  FACTURA_A = 1,        // Factura A
  FACTURA_B = 6,        // Factura B
  FACTURA_C = 11,       // Factura C
  NOTA_CREDITO_A = 3,   // Nota de Crédito A
  NOTA_CREDITO_B = 8,   // Nota de Crédito B
  NOTA_CREDITO_C = 13,  // Nota de Crédito C
}

export enum TipoDocumento {
  CUIT = 80,
  CUIL = 86,
  DNI = 96,
  PASAPORTE = 94,
  CONSUMIDOR_FINAL = 99, // Consumidor Final / Venta Global (para Factura B/C)
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

  @ApiProperty({ description: 'Número de comprobante (debe ser >= 1). Use FECompUltimoAutorizado para obtener el siguiente', example: 1 })
  @IsNumber()
  @Min(1)
  numeroComprobante: number;

  @ApiProperty({ description: 'Fecha del comprobante (YYYYMMDD)', example: '20241126' })
  @IsString()
  @IsNotEmpty()
  fechaComprobante: string;

  @ApiProperty({ description: 'CUIT del cliente', example: '20123456789' })
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

  @ApiProperty({ description: 'Importe neto gravado', example: 1000.0 })
  @IsNumber()
  @Min(0)
  importeNetoGravado: number;

  @ApiProperty({ description: 'Importe IVA', example: 210.0 })
  @IsNumber()
  @Min(0)
  importeIva: number;

  @ApiProperty({ description: 'Importe total', example: 1210.0 })
  @IsNumber()
  @Min(0)
  importeTotal: number;

  @ApiProperty({ description: 'Concepto (1-Productos, 2-Servicios, 3-Productos y Servicios)', example: 1 })
  @IsNumber()
  concepto: number;

  @ApiProperty({ description: 'Moneda ID (PES = Pesos, DOL = Dólares)', example: 'PES', required: false })
  @IsOptional()
  @IsString()
  monedaId?: string;

  @ApiProperty({ description: 'Cotización de la moneda', example: 1, required: false })
  @IsOptional()
  @IsNumber()
  cotizacionMoneda?: number;

  @ApiProperty({ 
    description: 'Condición frente al IVA del receptor (obligatorio desde 01/02/2026). Para Factura C, por defecto es 5 (Consumidor Final). Valores comunes: 1=No Responsable, 2=Exento, 3=No Gravado, 4=Responsable Inscripto, 5=Responsable No Inscripto (Consumidor Final), 6=Monotributo',
    example: 5,
    required: false
  })
  @IsOptional()
  @IsNumber()
  condicionIvaReceptor?: number;

  @ApiProperty({ 
    description: 'CUIT del emisor de la factura (sin guiones)', 
    example: '20123456789',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  cuitEmisor: string;

  @ApiProperty({ 
    description: 'Certificado digital (.crt) en formato PEM (texto completo con headers -----BEGIN/END-----) o base64',
    example: '-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAK...\n-----END CERTIFICATE-----',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  certificado: string;

  @ApiProperty({ 
    description: 'Clave privada (.key) en formato PEM (texto completo con headers -----BEGIN/END-----) o base64',
    example: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG...\n-----END PRIVATE KEY-----',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  clavePrivada: string;
}

