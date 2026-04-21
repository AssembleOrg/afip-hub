import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Mi Empresa SRL' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 120)
  name: string;

  @ApiProperty({
    example: 'mi-empresa',
    description: 'Slug único, kebab-case, para URLs y logs',
  })
  @IsString()
  @IsNotEmpty()
  @Length(3, 60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug debe ser kebab-case alfanumérico (ej: mi-empresa-3)',
  })
  slug: string;
}
