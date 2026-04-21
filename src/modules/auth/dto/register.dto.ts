import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'contacto@miempresa.com' })
  @IsEmail({}, { message: 'email inválido' })
  email: string;

  @ApiProperty({ example: 'SuperSecretoSaaS1!' })
  @IsString()
  @MinLength(8, { message: 'password mínimo 8 caracteres' })
  password: string;

  @ApiProperty({ example: 'Mi Empresa SRL' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 120)
  organizationName: string;

  @ApiProperty({
    example: 'mi-empresa',
    description: 'slug único de la organización (kebab-case)',
  })
  @IsString()
  @IsNotEmpty()
  @Length(3, 60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug debe ser kebab-case alfanumérico',
  })
  organizationSlug: string;

  @ApiPropertyOptional({
    description:
      'Opcional, slug del plan inicial. Si se omite, usa el plan default (free).',
  })
  @IsOptional()
  @IsString()
  planSlug?: string;
}
