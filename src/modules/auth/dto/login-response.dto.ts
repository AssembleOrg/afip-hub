import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiPropertyOptional({
    description: 'Refresh token plaintext (exponerlo como cookie httpOnly desde el frontend)',
  })
  refreshToken?: string;

  @ApiPropertyOptional({ description: 'Vencimiento del refresh token (ISO)' })
  refreshTokenExpiresAt?: Date;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    emailVerifiedAt: Date | null;
    platformRole: string | null;
    organizationId: string | null;
    orgRole: string | null;
  };

  @ApiPropertyOptional()
  organization?: {
    id: string;
    slug: string;
    name: string;
    planSlug: string;
    subscriptionStatus: string;
  } | null;

  @ApiPropertyOptional({ description: 'API key generada al registrarse (solo visible una vez)' })
  defaultApiKey?: {
    id: string;
    key: string;
    prefix: string;
  } | null;

  @ApiPropertyOptional({ description: 'ID de sesión (ancestorId del refresh token) para identificar la sesión actual' })
  sessionId?: string;
}
