import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VentanillaService } from './ventanilla.service';

@Injectable()
export class VentanillaCron {
  private readonly logger = new Logger(VentanillaCron.name);
  private running = false;

  constructor(private readonly service: VentanillaService) {}

  /**
   * Cada 4 horas: recorre emisores validados, consulta AFIP Ventanilla y
   * persiste mensajes nuevos. El lock `running` previene ejecuciones
   * concurrentes si el tick anterior sigue vivo (AFIP puede estar lento).
   */
  @Cron(CronExpression.EVERY_4_HOURS, { name: 'ventanilla-fetch' })
  async tick() {
    if (this.running) {
      this.logger.debug('Tick anterior aún corriendo, salteando');
      return;
    }
    this.running = true;
    const started = Date.now();
    try {
      const result = await this.service.fetchAllPending();
      const ms = Date.now() - started;
      this.logger.log(
        `Ventanilla tick OK: scanned=${result.scanned} new=${result.totalNew} took=${ms}ms`,
      );
      const errors = result.results.filter((r) => r.error);
      if (errors.length > 0) {
        this.logger.warn(
          `Ventanilla errores en ${errors.length} emisor(es): ${errors
            .slice(0, 5)
            .map((e) => `${e.emisorId}=${e.error}`)
            .join('; ')}`,
        );
      }
    } catch (err) {
      this.logger.error(`Ventanilla tick falló: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
