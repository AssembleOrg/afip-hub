import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/modules/email/email.service';
import { RefreshTokenRevokeReason } from '../../../generated/prisma';

export interface SessionDto {
  sessionId: string;
  label: string;
  userAgent: string | null;
  ip: string | null;
  startedAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Registra el dispositivo en `known_devices`. Si es nuevo y no es el primer
   * login de la cuenta, manda email de alerta. Best-effort — no bloquea el login.
   */
  async checkAndRegister(params: {
    userId: string;
    userEmail: string;
    fingerprintHash: string;
    userAgent: string | null;
    ip: string | null;
  }): Promise<void> {
    try {
      const label = this.parseUserAgent(params.userAgent);

      const knownCount = await this.prisma.knownDevice.count({
        where: { userId: params.userId },
      });
      const isFirstEver = knownCount === 0;

      const existing = await this.prisma.knownDevice.findUnique({
        where: {
          userId_fingerprintHash: {
            userId: params.userId,
            fingerprintHash: params.fingerprintHash,
          },
        },
      });

      if (existing) {
        await this.prisma.knownDevice.update({
          where: { id: existing.id },
          data: { lastSeenAt: new Date(), lastIp: params.ip, label },
        });
        return;
      }

      // Nuevo dispositivo
      await this.prisma.knownDevice.create({
        data: {
          userId: params.userId,
          fingerprintHash: params.fingerprintHash,
          label,
          lastIp: params.ip,
        },
      });

      if (!isFirstEver) {
        void this.sendNewDeviceEmail(params.userEmail, label, params.ip);
      }
    } catch (err) {
      this.logger.warn(`Error en checkAndRegister: ${String(err)}`);
    }
  }

  async listSessions(userId: string, currentSessionId: string | null): Promise<SessionDto[]> {
    const now = new Date();

    const activeTokens = await this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      select: {
        id: true,
        ancestorId: true,
        userAgent: true,
        ipCreated: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Un ancestorId = una sesión. Solo debería haber un token activo por cadena.
    const sessionsMap = new Map<string, typeof activeTokens[0]>();
    for (const t of activeTokens) {
      if (!sessionsMap.has(t.ancestorId)) sessionsMap.set(t.ancestorId, t);
    }
    const sessions = Array.from(sessionsMap.values());

    const ancestorIds = sessions.map((s) => s.ancestorId);
    const ancestors = await this.prisma.refreshToken.findMany({
      where: { id: { in: ancestorIds } },
      select: { id: true, createdAt: true },
    });
    const ancestorMap = new Map(ancestors.map((a) => [a.id, a.createdAt]));

    return sessions.map((s) => ({
      sessionId: s.ancestorId,
      label: this.parseUserAgent(s.userAgent),
      userAgent: s.userAgent,
      ip: s.ipCreated,
      startedAt: ancestorMap.get(s.ancestorId) ?? s.createdAt,
      lastActiveAt: s.createdAt,
      expiresAt: s.expiresAt,
      isCurrent: s.ancestorId === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, ancestorId: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: RefreshTokenRevokeReason.LOGOUT },
    });
  }

  async revokeAllOtherSessions(userId: string, currentSessionId: string | null): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { ancestorId: { not: currentSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: RefreshTokenRevokeReason.LOGOUT },
    });
  }

  hashFingerprint(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private async sendNewDeviceEmail(email: string, label: string, ip: string | null): Promise<void> {
    const productName = this.config.get<string>('branding.productName') ?? 'AFIP Hub';
    const dashboardUrl =
      this.config.get<string>('branding.dashboardUrl') ?? 'http://localhost:3000';

    await this.email
      .sendTemplate({
        to: email,
        template: 'new-device',
        subject: `Nuevo dispositivo conectado — ${productName}`,
        preheader: 'Se detectó un acceso desde un nuevo dispositivo a tu cuenta',
        data: {
          userName: email.split('@')[0],
          deviceLabel: label,
          ip: ip ?? 'desconocida',
          productName,
          securityUrl: `${dashboardUrl}/settings/security`,
        },
      })
      .catch((err) => this.logger.warn(`No se pudo enviar email nuevo-dispositivo: ${String(err)}`));
  }

  private parseUserAgent(ua: string | null): string {
    if (!ua) return 'Dispositivo desconocido';
    const os = this.detectOs(ua);
    if (/Edge|Edg\//i.test(ua)) return `Edge${os}`;
    if (/OPR|Opera/i.test(ua)) return `Opera${os}`;
    if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) return `Chrome${os}`;
    if (/Firefox/i.test(ua)) return `Firefox${os}`;
    if (/Safari/i.test(ua)) return `Safari${os}`;
    return `Navegador${os}`;
  }

  private detectOs(ua: string): string {
    if (/iPhone|iPad/i.test(ua)) return ' en iOS';
    if (/Android/i.test(ua)) return ' en Android';
    if (/Macintosh|Mac OS X/i.test(ua)) return ' en macOS';
    if (/Windows/i.test(ua)) return ' en Windows';
    if (/Linux/i.test(ua)) return ' en Linux';
    return '';
  }
}
