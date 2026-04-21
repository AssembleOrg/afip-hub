import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@/database/prisma.service';
import { EVENTS, StorageThresholdCrossedPayload } from '@/common/events';

export interface DbSizeSnapshot {
  totalBytes: number;
  volumeBytes: number;
  ratio: number;
  topTables: { table: string; bytes: number }[];
}

/**
 * Chequea periódicamente el tamaño del database de Postgres y emite el
 * evento `storage.threshold_crossed` cuando se cruza alguno de los umbrales
 * configurados (default 60/80/90). El subscriber dedupa por día + threshold
 * así un admin recibe máximo 1 mail por día por nivel.
 *
 * `volumeBytes` viene de env (`STORAGE_VOLUME_BYTES`, default 50 GB Railway).
 * Railway no expone el tamaño del volumen por API: hay que settearlo manual.
 */
@Injectable()
export class StorageAlertsService {
  private readonly logger = new Logger(StorageAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async snapshot(): Promise<DbSizeSnapshot> {
    const volumeBytes =
      this.config.get<number>('storageAlerts.volumeBytes') ?? 50 * 1024 ** 3;

    // Tamaño total del database
    const rows = await this.prisma.$queryRawUnsafe<Array<{ size: bigint }>>(
      `SELECT pg_database_size(current_database())::bigint AS size`,
    );
    const totalBytes = Number(rows[0]?.size ?? 0n);

    // Top 10 tablas del schema public. Usamos n.nspname (pg_namespace)
    // porque `schemaname` vive en pg_tables, no en pg_class.
    const tableRows = await this.prisma.$queryRawUnsafe<
      Array<{ table_name: string; size: bigint }>
    >(`
      SELECT n.nspname || '.' || c.relname AS table_name,
             pg_total_relation_size(c.oid)::bigint AS size
      FROM pg_class c
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY size DESC
      LIMIT 10
    `);
    const topTables = tableRows.map((r) => ({
      table: r.table_name,
      bytes: Number(r.size),
    }));

    return {
      totalBytes,
      volumeBytes,
      ratio: volumeBytes > 0 ? totalBytes / volumeBytes : 0,
      topTables,
    };
  }

  /**
   * Evalúa la snapshot actual y emite evento si cruza algún threshold.
   * Devuelve cuál fue el mayor threshold superado (o null si no hay).
   */
  async checkAndAlert(): Promise<number | null> {
    const snap = await this.snapshot();
    const pctNow = Math.floor(snap.ratio * 100);

    const thresholds = (
      this.config.get<number[]>('storageAlerts.thresholds') ?? [60, 80, 90]
    )
      .slice()
      .sort((a, b) => b - a); // evaluamos del más alto al más bajo

    const crossed = thresholds.find((t) => pctNow >= t);
    if (!crossed) {
      this.logger.debug(
        `Storage check: ${pctNow}% — bajo todos los thresholds (${thresholds.join('/')}%).`,
      );
      return null;
    }

    const payload: StorageThresholdCrossedPayload = {
      thresholdPct: crossed,
      usedBytes: snap.totalBytes,
      volumeBytes: snap.volumeBytes,
      usedRatio: snap.ratio,
      largestTables: snap.topTables.slice(0, 5),
      checkedAt: new Date(),
    };
    this.events.emit(EVENTS.STORAGE_THRESHOLD_CROSSED, payload);
    this.logger.warn(
      `Storage threshold cruzado: ${pctNow}% >= ${crossed}% (${snap.totalBytes}/${snap.volumeBytes} bytes)`,
    );
    return crossed;
  }
}
