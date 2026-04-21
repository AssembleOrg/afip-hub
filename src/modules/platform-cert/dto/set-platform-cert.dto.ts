import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetPlatformCertDto {
  @ApiProperty({ description: 'CUIT del emisor maestro (11 dígitos)' })
  @IsString()
  @Matches(/^\d{11}$/, { message: 'CUIT debe tener 11 dígitos' })
  cuit: string;

  @ApiProperty({ description: 'Certificado X.509 en formato PEM o base64' })
  @IsString()
  certificate: string;

  @ApiProperty({ description: 'Clave privada RSA en formato PEM o base64' })
  @IsString()
  privateKey: string;
}
