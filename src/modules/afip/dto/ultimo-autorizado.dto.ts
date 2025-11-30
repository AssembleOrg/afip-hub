import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min, IsString, IsNotEmpty } from 'class-validator';
import { TipoComprobante } from './create-invoice.dto';

export class UltimoAutorizadoDto {
  @ApiProperty({ description: 'Punto de venta', example: 1 })
  @IsNumber()
  @Min(1)
  puntoVenta: number;

  @ApiProperty({
    description: 'Tipo de comprobante',
    enum: TipoComprobante,
    example: TipoComprobante.FACTURA_B
  })
  @IsNumber()
  tipoComprobante: number;

  @ApiProperty({ 
    description: 'CUIT del emisor (sin guiones)', 
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

export class UltimoAutorizadoResponseDto {
  @ApiProperty({ description: 'Último número de comprobante autorizado', example: 5 })
  CbteNro: number;

  @ApiProperty({ description: 'Fecha del último comprobante autorizado (YYYYMMDD)', example: '20241126' })
  CbteFch: string;

  @ApiProperty({ description: 'Próximo número a usar', example: 6 })
  proximoNumero: number;
}

