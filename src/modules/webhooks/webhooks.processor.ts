import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '@/database/prisma.service';
import { RedisService } from '@/infra/redis';
import { QUEUE_WEBHOOKS } from '@/infra/queue/queue.module';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryStatus } from '../../../generated/prisma';

export interface WebhookDeliveryJob {
  deliveryId: string;
}

/**
 * Consumer de BullMQ para la cola `webhooks`. Un job = intentar entregar una
 * `WebhookDelivery` a su URL. BullMQ maneja retries con exponential backoff
 * (configurado en `QueueModule.defaultJobOptions`).
 *
 * Solo se registra si hay Redis. Sin Redis, `WebhooksWorker` (cron) hace el
 * polling de DB como fallback.
 *
 * En boot, re-queueamos cualquier PENDING que hubiera quedado en DB (por
 * ejemplo de una corrida previa sin BullMQ, o tras un deploy).
 */
@Injectable()
@Processor(QUEUE_WEBHOOKS, { concurrency: 10 })
export class WebhooksProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(
    @InjectQueue(QUEUE_WEBHOOKS) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly service: WebhooksService,
    private readonly redis: RedisService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    if (!this.redis.isAvailable()) return;
    const pending = await this.prisma.webhookDelivery.count({
      where: { status: WebhookDeliveryStatus.PENDING },
    });
    if (pending === 0) return;

    this.logger.log(`Re-queueando ${pending} deliveries PENDING (de corridas previas)`);
    // Re-queueamos en batches para no matar Redis de un saque.
    const batchSize = 100;
    let cursor: string | null = null;
    for (;;) {
      const batch = await this.prisma.webhookDelivery.findMany({
        where: {
          status: WebhookDeliveryStatus.PENDING,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        select: { id: true },
      });
      if (batch.length === 0) break;
      await this.queue.addBulk(
        batch.map((d) => ({
          name: 'deliver',
          data: { deliveryId: d.id },
        })),
      );
      cursor = batch[batch.length - 1].id;
      if (batch.length < batchSize) break;
    }
  }

  async process(job: Job<WebhookDeliveryJob>): Promise<boolean> {
    const { deliveryId } = job.data;
    this.logger.debug(
      `Procesando delivery=${deliveryId} attempt=${job.attemptsMade + 1}/${job.opts.attempts}`,
    );

    const delivered = await this.service.deliverById(deliveryId);
    if (!delivered) {
      // Tiramos para que BullMQ marque attempt failed y aplique backoff.
      throw new Error(`Delivery ${deliveryId} falló (ver lastError en DB)`);
    }
    return true;
  }
}
