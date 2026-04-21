import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WebhooksService } from './webhooks.service';
import { RedisService } from '@/infra/redis';

/**
 * Fallback cron para webhook deliveries cuando **no hay Redis** (BullMQ
 * deshabilitado). Polleamos DB cada 30s y entregamos PENDING.
 *
 * Con Redis, `WebhooksProcessor` (BullMQ) maneja la cola con retries nativos
 * y mejor throughput. Este cron detecta Redis en cada tick y se auto-suprime.
 */
@Injectable()
export class WebhooksWorker {
  private readonly logger = new Logger(WebhooksWorker.name);
  private running = false;

  constructor(
    private readonly service: WebhooksService,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'webhooks-deliver-fallback' })
  async tick() {
    // Con Redis: BullMQ WebhooksProcessor se encarga, no hacemos nada.
    if (this.redis.isAvailable()) return;

    if (this.running) return;
    this.running = true;
    try {
      const r = await this.service.processPending(50);
      if (r.processed > 0) {
        this.logger.log(
          `Webhooks fallback cron: processed=${r.processed} delivered=${r.delivered} failed=${r.failed}`,
        );
      }
    } catch (err) {
      this.logger.error(`Fallback cron tick falló: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
