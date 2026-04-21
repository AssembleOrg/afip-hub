import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class SubscribeDto {
  @ApiProperty({ example: 'growth' })
  @IsString()
  @IsNotEmpty()
  planSlug: string;

  @ApiPropertyOptional({
    description:
      'URL a la que MP redirigirá al usuario tras autorizar. Default: MP_BACK_SUCCESS_URL.',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  backUrl?: string;
}
