import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AfipLoginDto {
  @ApiProperty({ description: 'CUIT del contribuyente (sin guiones)', example: '20123456789' })
  @IsString({ message: 'El CUIT debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El CUIT es requerido' })
  cuit: string;

  @ApiProperty({ description: 'Servicio de AFIP a autenticar', example: 'wsfe' })
  @IsString({ message: 'El servicio debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El servicio es requerido' })
  service: string;

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

