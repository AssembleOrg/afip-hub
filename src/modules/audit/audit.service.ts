import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditActor } from '../../../generated/prisma';

export interface AuditRecordParams {
  actorType: AuditActor;
  actorUserId?: string | null;
  actorApiKeyId?: string | null;
  actorLabel?: string | null;
  organizationId?: string | null;
  action: string;
  result?: 'ok' | 'fail';
  severity?: 'info' | 'warn' | 'error';
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  changes?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditSearchFilters {
  organizationId?: string;
  actorUserId?: string;
  actorApiKeyId?: string;
  actorType?: AuditActor;
  action?: string;
  actionPrefix?: string;   // "auth." → match "auth.login", "auth.failed_login"
  targetType?: string;
  targetId?: string;
  result?: 'ok' | 'fail';
  severity?: 'info' | 'warn' | 'error';
  from?: Date;
  to?: Date;
  q?: string;              // full-text en actorLabel o targetId
  skip?: number;
  take?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Graba un evento de auditoría. **Nunca lanza** — un fallo al auditar no
   * debe romper la operación principal. Si falla, logueamos y seguimos.
   */
  async record(params: AuditRecordParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: params.actorType,
          actorUserId: params.actorUserId ?? null,
          actorApiKeyId: params.actorApiKeyId ?? null,
          actorLabel: params.actorLabel?.slice(0, 200) ?? null,
          organizationId: params.organizationId ?? null,
          action: params.action,
          result: params.result ?? 'ok',
          severity: params.severity ?? 'info',
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          metadata: params.metadata as any,
          changes: params.changes as any,
          ip: params.ip?.slice(0, 45) ?? null,
          userAgent: params.userAgent?.slice(0, 500) ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Fallo audit ${params.action} (result=${params.result ?? 'ok'}): ${String(err)}`,
      );
    }
  }

  async search(filters: AuditSearchFilters) {
    const where: any = {};

    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.actorUserId) where.actorUserId = filters.actorUserId;
    if (filters.actorApiKeyId) where.actorApiKeyId = filters.actorApiKeyId;
    if (filters.actorType) where.actorType = filters.actorType;
    if (filters.action) where.action = filters.action;
    else if (filters.actionPrefix) where.action = { startsWith: filters.actionPrefix };
    if (filters.targetType) where.targetType = filters.targetType;
    if (filters.targetId) where.targetId = filters.targetId;
    if (filters.result) where.result = filters.result;
    if (filters.severity) where.severity = filters.severity;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }
    if (filters.q) {
      where.OR = [
        { actorLabel: { contains: filters.q, mode: 'insensitive' } },
        { targetId: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(filters.take ?? 50, 200);
    const skip = filters.skip ?? 0;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data: items, meta: { total, skip, take } };
  }

  /** Lista los valores únicos de `action` vistos — útil para llenar selects en UI. */
  async listActions(organizationId?: string): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: organizationId ? { organizationId } : {},
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
      take: 500,
    });
    return rows.map((r) => r.action);
  }

  /** Cron: purga eventos más viejos que 13 meses. */
  async purgeOld(retentionDays = 395): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
    const r = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return r.count;
  }
}
