import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { RedisService } from '@/infra/redis';
import { AuditService } from '@/modules/audit/audit.service';
import { AuditActor } from '../../../generated/prisma';

const REDIS_KEY = (k: string) => `setting:${k}`;
const REDIS_TTL_SECONDS = 60;

@Injectable()
export class AdminSettingsService {
  private readonly logger = new Logger(AdminSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const items = await this.prisma.adminSetting.findMany({
      orderBy: { key: 'asc' },
    });
    return { items };
  }

  /**
   * Lee un setting con cache de 60s en Redis. Si no existe en DB, devuelve
   * `defaultValue` (sin persistir). No lanza; el caller decide qué hacer.
   */
  async get<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const cached = await this.redis.safeCall((r) => r.get(REDIS_KEY(key)));
    if (cached.ok && cached.value !== null) {
      try {
        return JSON.parse(cached.value) as T;
      } catch {
        /* fall through */
      }
    }

    const row = await this.prisma.adminSetting.findUnique({ where: { key } });
    if (!row) return defaultValue;

    await this.redis.safeCall((r) =>
      r.set(REDIS_KEY(key), JSON.stringify(row.value), 'EX', REDIS_TTL_SECONDS),
    );
    return row.value as T;
  }

  async set(
    key: string,
    value: unknown,
    updatedByUserId?: string,
    description?: string,
  ) {
    const previous = await this.prisma.adminSetting.findUnique({ where: { key } });

    const row = await this.prisma.adminSetting.upsert({
      where: { key },
      update: {
        value: value as any,
        updatedByUserId: updatedByUserId ?? null,
        ...(description !== undefined && { description }),
      },
      create: {
        key,
        value: value as any,
        updatedByUserId: updatedByUserId ?? null,
        description: description ?? null,
      },
    });

    // Invalida el cache.
    await this.redis.safeCall((r) => r.del(REDIS_KEY(key)));
    this.logger.log(`setting actualizado: ${key}`);

    void this.audit.record({
      actorType: AuditActor.PLATFORM_ADMIN,
      actorUserId: updatedByUserId ?? null,
      action: previous ? 'setting.updated' : 'setting.created',
      severity: 'warn',
      targetType: 'admin_setting',
      targetId: key,
      changes: previous ? { from: previous.value, to: value } : { value },
    });

    return row;
  }

  async getOrFail(key: string) {
    const row = await this.prisma.adminSetting.findUnique({ where: { key } });
    if (!row) throw new NotFoundException(`Setting "${key}" no existe`);
    return row;
  }
}
