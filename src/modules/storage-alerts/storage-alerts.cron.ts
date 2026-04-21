import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MetricsService } from '@/modules/metrics/metrics.service';
import { StorageAlertsService } from './storage-alerts.service';

/**
 * Diario a las 8am GMT-3: chequea el tamaño del DB, emite alerta si cruza
 * un threshold, y además actualiza gauges Prometheus (ratio + bytes).
 *
 * Corre 1x/día porque el crecimiento es lento. Si hay mucha volatilidad
 * (casi al 90%), se puede bajar a cada hora.
 */
@Injectable()
export class StorageAlertsCron {
  private readonly logger = new Logger(StorageAlertsCron.name);

  constructor(
    private readonly service: StorageAlertsService,
    private readonly metrics: MetricsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM, {
    name: 'storage-alerts-daily',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async daily() {
    await this.tick();
  }

  /** También corre al arrancar, para tener métricas desde el minuto 0. */
  async onApplicationBootstrap() {
    // Pequeño delay para que la DB ya esté conectada.
    setTimeout(() => {
      void this.tick();
    }, 5000);
  }

  private async tick() {
    try {
      const snap = await this.service.snapshot();
      this.metrics.dbSizeBytes.set(snap.totalBytes);
      this.metrics.dbUsageRatio.set(snap.ratio);
      for (const t of snap.topTables) {
        this.metrics.dbTableSizeBytes.set({ table: t.table }, t.bytes);
      }

      const crossed = await this.service.checkAndAlert();
      if (crossed) {
        this.logger.warn(
          `Storage en ${Math.floor(snap.ratio * 100)}% — threshold ${crossed}% cruzado, notificando a admins.`,
        );
      }
    } catch (err) {
      this.logger.error(`storage-alerts tick falló: ${String(err)}`);
    }
  }
}
