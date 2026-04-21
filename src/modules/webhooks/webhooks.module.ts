import { Module, Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksWorker } from './webhooks.worker';
import { WebhooksListener } from './webhooks.listener';
import { WebhooksProcessor } from './webhooks.processor';
import { QUEUE_WEBHOOKS } from '@/infra/queue/queue.module';

// Registramos la queue `webhooks` solo si hay Redis. Sin Redis, BullModule
// no se importa y `@Optional()` en WebhooksService resuelve queue=undefined.
// El `WebhooksWorker` cron se encarga como fallback.
const hasRedis = !!process.env.REDIS_URL;

const queueImports = hasRedis
  ? [BullModule.registerQueue({ name: QUEUE_WEBHOOKS })]
  : [];

const queueProviders: Provider[] = hasRedis ? [WebhooksProcessor] : [];

@Module({
  imports: queueImports,
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhooksWorker,
    WebhooksListener,
    ...queueProviders,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
