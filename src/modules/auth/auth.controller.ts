import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RefreshTokensService } from './refresh-tokens.service';
import {
  ForgotPasswordDto,
  LoginDto,
  LoginResponseDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto';
import { IpRateLimit } from '@/common/guards/ip-rate-limit.guard';
import { CurrentUser, Public, WebOnly } from '@/common';
import type { AuthenticatedUser, SaasRequest } from '@/common/types';
import { RefreshTokenRevokeReason } from '../../../generated/prisma';

@ApiTags('Auth')
@Controller('auth')
@WebOnly()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshTokens: RefreshTokensService,
  ) {}

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({
    summary: 'Devuelve el user autenticado + su org y estado',
    description:
      'Lee siempre de DB, así refleja cambios como emailVerifiedAt al toque. Pensado para que el frontend refetchee en `visibilitychange` / después de verificar.',
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException();
    return this.authService.getMe(user.id);
  }

  @Public()
  @IpRateLimit(5, 'auth-register')
  @Post('register')
  @ApiOperation({
    summary: 'Registrar usuario + organización (flujo self-service)',
    description:
      'Crea el usuario como OWNER de una nueva organización en el plan default (free) o el especificado. Rate-limit: 5/min por IP. Envía email de verificación automático.',
  })
  @ApiResponse({ status: 201, description: 'Cuenta creada', type: LoginResponseDto })
  register(
    @Body() dto: RegisterDto,
    @Req() req: SaasRequest,
  ): Promise<LoginResponseDto> {
    return this.authService.register(dto, this.ipOf(req), this.uaOf(req));
  }

  @Public()
  @IpRateLimit(10, 'auth-login')
  @Post('login')
  @ApiOperation({
    summary: 'Iniciar sesión del dashboard',
    description: 'Rate-limit: 10/min por IP (anti-bruteforce).',
  })
  @ApiResponse({ status: 200, description: 'Login exitoso', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  login(
    @Body() dto: LoginDto,
    @Req() req: SaasRequest,
  ): Promise<LoginResponseDto> {
    return this.authService.login(dto, this.ipOf(req), this.uaOf(req));
  }

  @Public()
  @IpRateLimit(10, 'auth-verify-email')
  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verifica el email con el token enviado por mail',
    description:
      'Endpoint JSON. El link del email apunta al frontend (`/verify-email?token=...`), que llama a este endpoint y muestra el resultado. Rate-limit: 10/min por IP.',
  })
  async verifyEmail(@Body() body: { token?: string }) {
    if (!body?.token) throw new BadRequestException('token requerido');
    return this.authService.verifyEmail(body.token);
  }

  @ApiBearerAuth()
  @IpRateLimit(3, 'auth-resend-verify')
  @Post('resend-verification')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reenviar email de verificación',
    description:
      'Requiere estar autenticado. Respeta cooldown de 24h desde el último token emitido. Rate-limit: 3/min por IP.',
  })
  async resendVerification(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException();
    const email = (await this.authService.getUserEmailIfNotVerified(user.id)) ??
      null;
    if (!email) {
      return { resent: false, reason: 'already_verified_or_not_found' };
    }
    const resent =
      await this.authService.resendVerificationEmailIfCooldownPassed(
        user.id,
        email,
      );
    return {
      resent,
      reason: resent ? 'sent' : 'cooldown_active',
    };
  }

  @Public()
  @IpRateLimit(3, 'auth-forgot')
  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Pedir email de reset de password',
    description:
      'Siempre responde 200 (no revela si el email existe). Rate-limit: 3/min por IP.',
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: SaasRequest,
  ) {
    await this.authService.forgotPassword(dto.email, this.ipOf(req));
    return { ok: true };
  }

  @Public()
  @IpRateLimit(5, 'auth-reset')
  @Post('reset-password')
  @ApiOperation({ summary: 'Resetear password con el token recibido por mail' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: SaasRequest,
  ) {
    await this.authService.resetPassword(
      dto.token,
      dto.newPassword,
      this.ipOf(req),
    );
    return { ok: true };
  }

  @Public()
  @IpRateLimit(30, 'auth-refresh')
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotar refresh token → nuevo access + nuevo refresh',
    description:
      'El cliente manda el refresh actual (body o cookie `afiphub_refresh`). Respuesta: access token + refresh token nuevo. El viejo queda revocado. Si llega un refresh ya rotado/revocado → asumimos robo y matamos toda la cadena.',
  })
  @ApiResponse({ status: 200, description: 'Tokens rotados' })
  @ApiResponse({ status: 401, description: 'Refresh inválido / expirado / reused' })
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: SaasRequest,
  ) {
    const fromCookie = this.extractCookie(req, 'afiphub_refresh');
    const plain = body?.refreshToken || fromCookie;
    if (!plain) throw new UnauthorizedException('refresh token requerido');

    const { newToken, userId } = await this.refreshTokens.rotate({
      plainToken: plain,
      ip: this.ipOf(req),
      userAgent: this.uaOf(req),
    });

    const session = await this.authService.buildSessionPublic(userId);
    return {
      ...session,
      refreshToken: newToken.plainToken,
      refreshTokenExpiresAt: newToken.expiresAt,
    };
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cerrar sesión (revoca el refresh token actual)',
    description:
      'Revoca el refresh que el cliente provee. El access token sigue vivo hasta su expiración natural (≤1h).',
  })
  async logout(
    @Body() body: { refreshToken?: string },
    @Req() req: SaasRequest,
  ) {
    const fromCookie = this.extractCookie(req, 'afiphub_refresh');
    const plain = body?.refreshToken || fromCookie;
    if (plain) {
      await this.refreshTokens.revoke(plain, RefreshTokenRevokeReason.LOGOUT);
    }
    return { ok: true };
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cerrar TODAS las sesiones del user (revoca todos sus refresh tokens)',
  })
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.id) throw new UnauthorizedException();
    const count = await this.refreshTokens.revokeAllForUser(
      user.id,
      RefreshTokenRevokeReason.SECURITY_ACTION,
    );
    return { ok: true, revokedCount: count };
  }

  private extractCookie(req: SaasRequest, name: string): string | undefined {
    const header = req.headers['cookie'];
    if (typeof header !== 'string') return undefined;
    const pairs = header.split(';').map((p) => p.trim().split('='));
    const found = pairs.find(([k]) => k === name);
    return found?.[1];
  }

  private ipOf(req: SaasRequest): string {
    return (req.ip || req.socket?.remoteAddress || '').toString();
  }

  private uaOf(req: SaasRequest): string | undefined {
    const ua = req.headers['user-agent'];
    return typeof ua === 'string' ? ua : undefined;
  }
}
