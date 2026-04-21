import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const QUEUE_WEBHOOKS = 'webhooks';

/**
 * Registra BullMQ solo si hay `REDIS_URL`. Sin Redis, el módulo queda vacío
 * y los módulos que dependen de una Queue deben detectarlo (ver
 * `WebhooksWorker` — corre como cron DB-polling fallback).
 *
 * Convención de colas:
 *  - `webhooks` → outbound webhooks a clientes (con retries y HMAC)
 */
@Global()
@Module({})
export class QueueModule {
  private static readonly logger = new Logger('QueueModule');

  static register(): DynamicModule {
    const hasRedis = !!process.env.REDIS_URL;

    if (!hasRedis) {
      this.logger.warn(
        'REDIS_URL no seteado → BullMQ deshabilitado. Webhooks usarán fallback de cron DB-polling (OK dev, no recomendado multi-instancia).',
      );
      return {
        module: QueueModule,
        imports: [],
        exports: [],
      };
    }

    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            connection: {
              url: config.get<string>('redis.url')!,
            },
            defaultJobOptions: {
              // Retries built-in de BullMQ con exponential backoff.
              attempts: 8,
              backoff: {
                type: 'exponential',
                delay: 30_000, // 30s inicial, duplica cada vez (30s→1m→2m→...→~64min cap)
              },
              removeOnComplete: { age: 24 * 3600, count: 10_000 }, // 24h o 10k jobs
              removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },  // 7 días / 5k fails
            },
          }),
        }),
        BullModule.registerQueue({ name: QUEUE_WEBHOOKS }),
      ],
      exports: [BullModule],
    };
  }
}
