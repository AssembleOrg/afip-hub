import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import {
  AuditActor,
  RefreshTokenRevokeReason,
} from '../../../generated/prisma';

const REFRESH_TOKEN_BYTES = 32; // 256 bits

export interface IssuedRefreshToken {
  plainToken: string;
  id: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

@Injectable()
export class RefreshTokensService {
  private readonly logger = new Logger(RefreshTokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Emite un refresh token nuevo para un user (llamado al login/register).
   * El `plainToken` devuelto solo existe en memoria — en DB guardamos el hash.
   */
  async issueForUser(params: {
    userId: string;
    userAgent?: string;
    ip?: string;
  }): Promise<IssuedRefreshToken> {
    const days = this.config.get<number>('jwt.refreshTokenDays') ?? 30;
    const absoluteDays =
      this.config.get<number>('jwt.refreshTokenAbsoluteDays') ?? 90;

    const plainToken = this.generateToken();
    const hashedToken = this.hash(plainToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86400_000);
    const absoluteExpiresAt = new Date(now.getTime() + absoluteDays * 86400_000);

    // Al emitir desde login/register, ancestorId = id del token (nueva cadena)
    const record = await this.prisma.$transaction(async (tx) => {
      const row = await tx.refreshToken.create({
        data: {
          userId: params.userId,
          hashedToken,
          ancestorId: '', // placeholder — se actualiza al saber el id
          parentTokenId: null,
          userAgent: params.userAgent?.slice(0, 500) ?? null,
          ipCreated: params.ip?.slice(0, 45) ?? null,
          expiresAt,
          absoluteExpiresAt,
        },
      });
      return tx.refreshToken.update({
        where: { id: row.id },
        data: { ancestorId: row.id },
      });
    });

    return {
      plainToken,
      id: record.id,
      expiresAt,
      absoluteExpiresAt,
    };
  }

  /**
   * Rota un refresh token: valida el viejo, lo marca como ROTATED y emite uno
   * nuevo. Si el viejo ya fue rotado/revocado, asumimos reuse (posible robo):
   * revocamos TODA la cadena (mismo `ancestorId`) y forzamos re-login.
   */
  async rotate(params: {
    plainToken: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ newToken: IssuedRefreshToken; userId: string }> {
    const hashedToken = this.hash(params.plainToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { hashedToken },
    });

    if (!existing) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    // ¿Ya revocado? → posible reuse. Matamos toda la cadena.
    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: {
          ancestorId: existing.ancestorId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokedReason: RefreshTokenRevokeReason.REUSE_DETECTED,
        },
      });
      void this.audit.record({
        actorType: AuditActor.SYSTEM,
        actorUserId: existing.userId,
        action: 'auth.refresh_reuse_detected',
        severity: 'warn',
        targetType: 'refresh_token',
        targetId: existing.id,
        metadata: { ancestorId: existing.ancestorId },
      });
      this.logger.warn(
        `Refresh token reuse detectado user=${existing.userId} ancestor=${existing.ancestorId} — toda la cadena revocada`,
      );
      throw new UnauthorizedException(
        'Refresh token reusado — sesión terminada por seguridad',
      );
    }

    // Expirado (absoluto o sliding)?
    const now = new Date();
    if (existing.expiresAt < now || existing.absoluteExpiresAt < now) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: {
          revokedAt: now,
          revokedReason: RefreshTokenRevokeReason.EXPIRED,
        },
      });
      throw new UnauthorizedException('Refresh token expirado');
    }

    // Todo OK → rotamos. Transacción: revoca viejo + crea nuevo con mismo ancestor.
    const days = this.config.get<number>('jwt.refreshTokenDays') ?? 30;
    const plainToken = this.generateToken();
    const newHashed = this.hash(plainToken);
    const newExpiresAt = new Date(now.getTime() + days * 86400_000);
    // El absoluteExpiresAt NO se extiende — se mantiene del original (topeado a 90d desde login)
    const newAbsolute = new Date(
      Math.min(newExpiresAt.getTime(), existing.absoluteExpiresAt.getTime()),
    );

    const newRow = await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: {
          revokedAt: now,
          revokedReason: RefreshTokenRevokeReason.ROTATED,
        },
      });
      return tx.refreshToken.create({
        data: {
          userId: existing.userId,
          hashedToken: newHashed,
          ancestorId: existing.ancestorId,
          parentTokenId: existing.id,
          userAgent: params.userAgent?.slice(0, 500) ?? existing.userAgent,
          ipCreated: params.ip?.slice(0, 45) ?? existing.ipCreated,
          expiresAt: newExpiresAt,
          absoluteExpiresAt: newAbsolute,
        },
      });
    });

    return {
      newToken: {
        plainToken,
        id: newRow.id,
        expiresAt: newRow.expiresAt,
        absoluteExpiresAt: newRow.absoluteExpiresAt,
      },
      userId: existing.userId,
    };
  }

  /** Revoca un refresh token específico (logout). */
  async revoke(
    plainToken: string,
    reason: RefreshTokenRevokeReason = RefreshTokenRevokeReason.LOGOUT,
  ): Promise<void> {
    const hashedToken = this.hash(plainToken);
    await this.prisma.refreshToken
      .updateMany({
        where: { hashedToken, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      })
      .catch(() => undefined);
  }

  /** Revoca todos los refresh tokens de un user (logout-all / cambio password). */
  async revokeAllForUser(
    userId: string,
    reason: RefreshTokenRevokeReason = RefreshTokenRevokeReason.SECURITY_ACTION,
  ): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count;
  }

  private generateToken(): string {
    return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  private hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
