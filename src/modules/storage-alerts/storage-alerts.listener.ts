import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/database/prisma.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { EVENTS } from '@/common/events';
import type { StorageThresholdCrossedPayload } from '@/common/events';
import { formatLocal } from '@/common/utils/clock';
import {
  NotificationKind,
  PlatformRole,
} from '../../../generated/prisma';

/**
 * Al recibir `STORAGE_THRESHOLD_CROSSED`, manda 1 email por cada platform
 * admin activo. Dedupe por `{threshold}:{yyyy-mm-dd}` → máximo 1 email por
 * nivel por día.
 */
@Injectable()
export class StorageAlertsListener {
  private readonly logger = new Logger(StorageAlertsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(EVENTS.STORAGE_THRESHOLD_CROSSED, { async: true })
  async handle(p: StorageThresholdCrossedPayload) {
    const admins = await this.prisma.user.findMany({
      where: {
        platformRole: PlatformRole.ADMIN,
        deletedAt: null,
      },
      select: { id: true, email: true },
    });

    if (admins.length === 0) {
      this.logger.warn(
        'No hay platform admins para notificar — storage al ' +
          `${Math.floor(p.usedRatio * 100)}%`,
      );
      return;
    }

    const today = formatLocal(p.checkedAt, 'date').replace(/\//g, '-');
    const productName =
      this.config.get<string>('branding.productName') ?? 'AFIP Hub';
    const pctNow = Math.floor(p.usedRatio * 100);
    const isCritical = p.thresholdPct >= 90;

    const templateData = {
      productName,
      thresholdPct: p.thresholdPct,
      usedBytes: p.usedBytes,
      volumeBytes: p.volumeBytes,
      usedHuman: this.humanBytes(p.usedBytes),
      volumeHuman: this.humanBytes(p.volumeBytes),
      usedPct: pctNow,
      checkedAt: formatLocal(p.checkedAt, 'datetime'),
      isCritical,
      largestTables: p.largestTables.map((t) => ({
        table: t.table,
        bytesHuman: this.humanBytes(t.bytes),
      })),
    };

    for (const admin of admins) {
      // Dedupe key: cada admin recibe máximo 1 email por threshold por día.
      const dedupeKey = `storage_warning:${p.thresholdPct}:${today}:${admin.id}`;
      await this.notifications.notify({
        kind: NotificationKind.STORAGE_WARNING,
        toEmail: admin.email,
        userId: admin.id,
        dedupeKey,
        template: 'storage-warning',
        subject: `[${productName}] Volumen DB al ${pctNow}%${isCritical ? ' — urgente' : ''}`,
        preheader: `${this.humanBytes(p.usedBytes)} de ${this.humanBytes(p.volumeBytes)} usados. Actuá antes del 100%.`,
        data: templateData,
      });
    }
  }

  private humanBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(1)} ${units[i]}`;
  }
}
