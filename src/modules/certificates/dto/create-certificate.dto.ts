import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class CreateCertificateDto {
  @ApiProperty({ example: 'Producción CUIT 20-12345678-9' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  alias: string;

  @ApiProperty({
    description:
      'Certificado AFIP en formato PEM (incluir -----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----).',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/-----BEGIN CERTIFICATE-----/, {
    message: 'El certificado debe estar en formato PEM',
  })
  certificate: string;

  @ApiProperty({
    description: 'Clave privada correspondiente al certificado, en formato PEM.',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, {
    message: 'La clave privada debe estar en formato PEM',
  })
  privateKey: string;
}
