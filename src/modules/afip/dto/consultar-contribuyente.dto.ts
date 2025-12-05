import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConsultarContribuyenteDto {
  @ApiProperty({ 
    description: 'CUIT del contribuyente a consultar (sin guiones)', 
    example: '20386949604',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  cuit: string;

  @ApiProperty({ 
    description: 'CUIT del emisor (quien consulta)', 
    example: '20123456789',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  cuitEmisor: string;

  @ApiProperty({ 
    description: 'Certificado digital (.crt) en formato PEM (texto completo con headers -----BEGIN/END-----) o base64',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  certificado: string;

  @ApiProperty({ 
    description: 'Clave privada (.key) en formato PEM (texto completo con headers -----BEGIN/END-----) o base64',
    required: true
  })
  @IsString()
  @IsNotEmpty()
  clavePrivada: string;
}

export class ContribuyenteResponseDto {
  @ApiProperty({ description: 'CUIT consultado' })
  cuit: string;

  @ApiProperty({ description: 'Denominación / Razón Social' })
  denominacion: string;

  @ApiProperty({ description: 'Tipo de persona (FISICA, JURIDICA)' })
  tipoPersona: string;

  @ApiProperty({ description: 'Condición frente al IVA' })
  condicionIva: string;

  @ApiProperty({ description: 'Código de condición frente al IVA' })
  condicionIvaCodigo: number;

  @ApiProperty({ description: 'Estado del contribuyente' })
  estado: string;

  @ApiProperty({ description: 'Domicilio fiscal (objeto completo de AFIP)' })
  domicilio?: {
    codPostal: string;
    descripcionProvincia: string;
    localidad: string;
    direccion: string;
    datoAdicional: string;
    tipoDomicilio: string;
    tipoDatoAdicional: string;
    idProvincia: string;
  };

  @ApiProperty({ description: 'Fecha de inscripción' })
  fechaInscripcion?: string;
}

