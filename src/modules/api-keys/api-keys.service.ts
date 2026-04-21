import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { CreateApiKeyDto } from './dto';
import { ResolvedApiKey, ResolvedOrganization } from '@/common/types';
import { AuditActor, Prisma } from '../../../generated/prisma';

const KEY_BYTES = 32; // 256 bits → base64url ≈ 43 chars
const KEY_PREFIX_CHARS = 12;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Devuelve la key plaintext UNA sola vez (en la creación). Después nunca más. */
  async create(
    orgId: string,
    createdByUserId: string,
    dto: CreateApiKeyDto,
    environment: 'production' | 'homologacion',
  ) {
    // Revoca todas las keys activas del mismo environment antes de crear la nueva.
    const activeKeys = await this.prisma.apiKey.findMany({
      where: {
        organizationId: orgId,
        revokedAt: null,
        prefix: { startsWith: environment === 'production' ? 'ah_live_' : 'ah_test_' },
      },
      select: { id: true, name: true, prefix: true },
    });

    if (activeKeys.length > 0) {
      await this.prisma.apiKey.updateMany({
        where: { id: { in: activeKeys.map((k) => k.id) } },
        data: { revokedAt: new Date() },
      });
      for (const key of activeKeys) {
        void this.audit.record({
          actorType: AuditActor.USER,
          actorUserId: createdByUserId,
          organizationId: orgId,
          action: 'api_key.revoked',
          severity: 'warn',
          targetType: 'api_key',
          targetId: key.id,
          metadata: { name: key.name, prefix: key.prefix, reason: 'rotation' },
        });
      }
    }

    const raw = this.generateRawKey(environment);
    const hashed = this.hashKey(raw);
    const prefix = raw.slice(0, KEY_PREFIX_CHARS);

    const created = await this.prisma.apiKey.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        prefix,
        hashedKey: hashed,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdByUserId,
      },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: createdByUserId,
      organizationId: orgId,
      action: 'api_key.created',
      severity: 'warn',
      targetType: 'api_key',
      targetId: created.id,
      metadata: {
        name: created.name,
        prefix: created.prefix,
        environment,
        expiresAt: created.expiresAt,
      },
    });

    return {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      key: raw, // ← plaintext, mostrar una vez
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
    };
  }

  async list(orgId: string) {
    const items = await this.prisma.apiKey.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        lastUsedIp: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  async revoke(orgId: string, id: string, actorUserId?: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key no encontrada');
    if (key.organizationId !== orgId) {
      throw new ForbiddenException('Esa API key no pertenece a tu organización');
    }
    if (key.revokedAt) return key;

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: actorUserId ?? null,
      organizationId: orgId,
      action: 'api_key.revoked',
      severity: 'warn',
      targetType: 'api_key',
      targetId: id,
      metadata: { name: key.name, prefix: key.prefix },
    });

    return updated;
  }

  /**
   * Resuelve una API key entrante (desde header) a la organización dueña y
   * valida que esté viva (no revocada, no vencida, org activa).
   *
   * Devuelve contexto listo para inyectar al request; lanza si es inválida.
   */
  async resolveForRequest(rawKey: string, ip?: string): Promise<{
    apiKey: ResolvedApiKey;
    org: ResolvedOrganization;
  }> {
    if (!rawKey || typeof rawKey !== 'string') {
      throw new UnauthorizedException('API key requerida');
    }

    const hashed = this.hashKey(rawKey);
    const record = await this.prisma.apiKey.findUnique({
      where: { hashedKey: hashed },
      include: { organization: { include: { plan: true } } },
    });

    if (!record) throw new UnauthorizedException('API key inválida');
    if (record.revokedAt) throw new UnauthorizedException('API key revocada');
    if (record.expiresAt && record.expiresAt < new Date()) {
      throw new UnauthorizedException('API key vencida');
    }

    const org = record.organization;
    if (!org || org.deletedAt) {
      throw new UnauthorizedException('Organización inactiva');
    }
    if (org.suspendedAt) {
      throw new ForbiddenException(
        `Organización suspendida: ${org.suspendedReason ?? 'contactar soporte'}`,
      );
    }

    // Fire-and-forget: actualizar lastUsed sin bloquear el request.
    this.touchLastUsed(record.id, ip).catch(() => {});

    return {
      apiKey: {
        id: record.id,
        prefix: record.prefix,
        organizationId: org.id,
      },
      org: {
        id: org.id,
        slug: org.slug,
        name: org.name,
        planId: org.planId,
        planSlug: org.plan.slug,
        requestsLimit: org.plan.requestsLimit,
        pdfLimit: org.plan.pdfLimit,
        graceFactor: Number(org.plan.graceFactor),
        pdfRateLimitPerMin: org.plan.pdfRateLimitPerMin,
        taRateLimitPerMin: org.plan.taRateLimitPerMin,
        cuitLimit: org.plan.cuitLimit,
        subscriptionStatus: org.subscriptionStatus,
        currentPeriodStart: org.currentPeriodStart,
        currentPeriodEnd: org.currentPeriodEnd,
        suspendedAt: org.suspendedAt,
      },
    };
  }

  private async touchLastUsed(apiKeyId: string, ip?: string) {
    try {
      await this.prisma.apiKey.update({
        where: { id: apiKeyId },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: ip?.slice(0, 45) ?? null,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        return; // key borrada entre medio, ignoramos
      }
      throw e;
    }
  }

  private generateRawKey(env: 'production' | 'homologacion'): string {
    const prefix = env === 'production' ? 'ah_live_' : 'ah_test_';
    const random = crypto.randomBytes(KEY_BYTES).toString('base64url');
    return `${prefix}${random}`;
  }

  private hashKey(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
