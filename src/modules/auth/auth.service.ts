import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { PrismaService } from '@/database/prisma.service';
import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { EmailService } from '@/modules/email/email.service';
import { AuditService } from '@/modules/audit/audit.service';
import { ApiKeysService } from '@/modules/api-keys/api-keys.service';
import { RefreshTokensService } from './refresh-tokens.service';
import { DevicesService } from './devices.service';
import { AuditActor } from '../../../generated/prisma';
import {
  LoginDto,
  LoginResponseDto,
  RegisterDto,
} from './dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly orgsService: OrganizationsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly apiKeys: ApiKeysService,
    private readonly refreshTokens: RefreshTokensService,
    private readonly devicesService: DevicesService,
  ) {}

  async register(dto: RegisterDto, ip?: string, userAgent?: string): Promise<LoginResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Ese email ya está registrado');
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
      },
    });

    const org = await this.orgsService.createForOwner({
      ownerUserId: user.id,
      name: dto.organizationName,
      slug: dto.organizationSlug,
      planSlug: dto.planSlug,
    });

    // Generar API key por defecto — plaintext visible solo aquí, una vez.
    const defaultKey = await this.apiKeys.create(
      org.id,
      user.id,
      { name: 'default' },
      'production',
    );

    // Enviar email de verificación (no bloqueante)
    void this.sendVerificationEmail(user.id, user.email).catch((err) =>
      this.logger.error(`Fallo enviando verify email: ${String(err)}`),
    );

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: user.id,
      actorLabel: user.email,
      organizationId: org.id,
      action: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      metadata: { orgSlug: dto.organizationSlug, planSlug: dto.planSlug },
      ip,
      userAgent,
    });

    const refresh = await this.refreshTokens.issueForUser({
      userId: user.id,
      ip,
      userAgent,
    });
    const session = await this.buildSession(user.id);
    return {
      ...session,
      refreshToken: refresh.plainToken,
      refreshTokenExpiresAt: refresh.expiresAt,
      defaultApiKey: {
        id: defaultKey.id,
        key: defaultKey.key,
        prefix: defaultKey.prefix,
      },
    };
  }

  async login(
    dto: LoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.deletedAt) {
      void this.audit.record({
        actorType: AuditActor.USER,
        actorLabel: dto.email,
        action: 'auth.login_failed',
        result: 'fail',
        severity: 'warn',
        metadata: { reason: 'user_not_found' },
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) {
      void this.audit.record({
        actorType: AuditActor.USER,
        actorUserId: user.id,
        actorLabel: user.email,
        action: 'auth.login_failed',
        result: 'fail',
        severity: 'warn',
        targetType: 'user',
        targetId: user.id,
        metadata: { reason: 'bad_password' },
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Credenciales inválidas');
    }

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: user.id,
      actorLabel: user.email,
      organizationId: user.organizationId,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      ip,
      userAgent,
    });

    // Auto-reenvío de email de verificación: si no verificó y pasó el cooldown
    // (24h) desde el último token, reenviamos en background para que no pierda
    // el link si nunca abrió el primero.
    if (!user.emailVerifiedAt) {
      void this.resendVerificationEmailIfCooldownPassed(user.id, user.email)
        .then((resent) => {
          if (resent) {
            this.logger.log(
              `Auto-reenvío de verify email para user=${user.id} (cooldown cumplido)`,
            );
          }
        })
        .catch((err) =>
          this.logger.error(`Fallo auto-reenvío verify: ${String(err)}`),
        );
    }

    const refresh = await this.refreshTokens.issueForUser({
      userId: user.id,
      ip,
      userAgent,
    });

    if (dto.fingerprint) {
      void this.devicesService.checkAndRegister({
        userId: user.id,
        userEmail: user.email,
        fingerprintHash: this.devicesService.hashFingerprint(dto.fingerprint),
        userAgent: userAgent ?? null,
        ip: ip ?? null,
      });
    }

    const session = await this.buildSession(user.id);
    return {
      ...session,
      refreshToken: refresh.plainToken,
      refreshTokenExpiresAt: refresh.expiresAt,
      sessionId: refresh.id,
    };
  }

  /**
   * Email verify: genera token random, guarda solo el hash, manda link.
   * Invalida tokens previos no usados del mismo user (para ese email) para
   * evitar que haya múltiples vivos al mismo tiempo.
   *
   * Token plaintext nunca se persiste (igual que las API keys).
   */
  async sendVerificationEmail(userId: string, email: string): Promise<void> {
    const ttlHours = this.config.get<number>('verifyEmail.tokenTtlHours') ?? 24;
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

    // Invalidar tokens previos vivos del mismo user → solo el nuevo queda útil.
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId,
          email,
          tokenHash,
          expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000),
        },
      }),
    ]);

    // El link apunta al frontend: extraemos el origin del dashboardUrl porque
    // la página /verify-email vive en la raíz, no bajo /dashboard.
    const rawFrontendUrl =
      this.config.get<string>('branding.dashboardUrl') ||
      this.config.get<string>('publicBaseUrl') ||
      'http://localhost:3000';
    let frontendOrigin = rawFrontendUrl;
    try {
      frontendOrigin = new URL(rawFrontendUrl).origin;
    } catch {
      /* si no parsea, usamos tal cual */
    }
    const link = `${frontendOrigin}/verify-email?token=${raw}`;
    const productName =
      this.config.get<string>('branding.productName') || 'AFIP Hub';

    await this.email.sendTemplate({
      to: email,
      template: 'verify-email',
      subject: `Verificá tu email — ${productName}`,
      preheader: `Activá tu cuenta de ${productName} en un click`,
      data: {
        userName: email.split('@')[0],
        link,
        ttlHours,
      },
    });
  }

  /**
   * Usado por el endpoint público de re-envío: devuelve el email del user
   * SOLO si no está verificado todavía. Null si ya verificó (no hay nada
   * para reenviar) o si el user no existe.
   */
  async getUserEmailIfNotVerified(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt) return null;
    if (user.emailVerifiedAt) return null;
    return user.email;
  }

  /**
   * Reenvío "manual" o "auto" (desde login): chequea cooldown de 24h desde
   * el último token emitido para no spamear. Devuelve `resent: boolean`.
   */
  async resendVerificationEmailIfCooldownPassed(
    userId: string,
    email: string,
  ): Promise<boolean> {
    const cooldownHours =
      this.config.get<number>('verifyEmail.autoResendCooldownHours') ?? 24;
    const threshold = new Date(Date.now() - cooldownHours * 3600 * 1000);

    const last = await this.prisma.emailVerificationToken.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (last && last.createdAt > threshold) {
      return false; // dentro del cooldown, no reenvío
    }

    await this.sendVerificationEmail(userId, email);
    return true;
  }

  async verifyEmail(rawToken: string): Promise<{ ok: true; userId: string }> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const token = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('Token inválido o vencido');
    }
    if (token.email !== token.user.email) {
      // El user cambió de email entre tanto — invalidamos.
      await this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      });
      throw new BadRequestException('El email del token no coincide con el actual');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: token.userId,
      actorLabel: token.email,
      action: 'auth.email_verified',
      targetType: 'user',
      targetId: token.userId,
    });

    return { ok: true, userId: token.userId };
  }

  /**
   * Forgot password: SIEMPRE devuelve OK (evita user enumeration). Si el
   * email existe, mandamos link; si no, callamos.
   */
  async forgotPassword(email: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      this.logger.debug(`Forgot password para email inexistente: ${email}`);
      return;
    }

    const ttlMin = this.config.get<number>('passwordReset.tokenTtlMinutes') ?? 60;
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + ttlMin * 60 * 1000),
        ipRequested: ip ?? null,
      },
    });

    const dashboardUrl =
      this.config.get<string>('branding.dashboardUrl') ||
      this.config.get<string>('publicBaseUrl') ||
      'http://localhost:3000';
    const link = `${dashboardUrl}/auth/reset-password?token=${raw}`;
    const productName =
      this.config.get<string>('branding.productName') || 'AFIP Hub';

    await this.email.sendTemplate({
      to: user.email,
      template: 'password-reset',
      subject: `Reset de contraseña — ${productName}`,
      preheader: 'Cambiá tu contraseña siguiendo este link seguro',
      data: {
        email: user.email,
        link,
        ttlMinutes: ttlMin,
        ipRequested: ip ?? null,
      },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: user.id,
      actorLabel: user.email,
      action: 'auth.password_reset_requested',
      targetType: 'user',
      targetId: user.id,
      ip,
    });
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    ip?: string,
  ): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('Token inválido o vencido');
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { password: hashed },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      // Invalidar otros tokens activos del mismo user.
      this.prisma.passwordResetToken.updateMany({
        where: {
          userId: token.userId,
          usedAt: null,
          id: { not: token.id },
        },
        data: { usedAt: new Date() },
      }),
    ]);

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: token.userId,
      action: 'auth.password_reset_completed',
      severity: 'warn',
      targetType: 'user',
      targetId: token.userId,
      ip,
    });
  }

  /** Wrapper público de buildSession, usado por el controller en /auth/refresh. */
  buildSessionPublic(userId: string): Promise<LoginResponseDto> {
    return this.buildSession(userId);
  }

  /**
   * Devuelve snapshot del user + org al momento actual (siempre desde DB).
   * Usado por GET /auth/me para que el frontend refetchee después de verificar
   * email u otros cambios de estado.
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: { include: { plan: true } } },
    });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException();
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        platformRole: user.platformRole,
        organizationId: user.organizationId,
        orgRole: user.orgRole,
      },
      organization: user.organization
        ? {
            id: user.organization.id,
            slug: user.organization.slug,
            name: user.organization.name,
            planSlug: user.organization.plan.slug,
            planName: user.organization.plan.name,
            subscriptionStatus: user.organization.subscriptionStatus,
            currentPeriodEnd: user.organization.currentPeriodEnd,
            suspendedAt: user.organization.suspendedAt,
          }
        : null,
    };
  }

  private async buildSession(userId: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: { include: { plan: true } } },
    });
    if (!user) throw new UnauthorizedException();

    const payload = {
      sub: user.id,
      email: user.email,
      platformRole: user.platformRole,
      organizationId: user.organizationId,
      orgRole: user.orgRole,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        platformRole: user.platformRole,
        organizationId: user.organizationId,
        orgRole: user.orgRole,
      },
      organization: user.organization
        ? {
            id: user.organization.id,
            slug: user.organization.slug,
            name: user.organization.name,
            planSlug: user.organization.plan.slug,
            subscriptionStatus: user.organization.subscriptionStatus,
          }
        : null,
    };
  }
}
