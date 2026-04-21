import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Cliente Redis opcional. Si no hay `REDIS_URL` seteado, `client` queda `null`
 * y cualquier consumidor debe manejar el fallback (memoria / DB directo).
 *
 * Persistencia: asumimos el Redis gestionado (Railway/Upstash/Elasticache) con
 * AOF habilitado. El counter principal está en Postgres, así que este Redis
 * solo acelera; si se cae, la app sigue funcionando degradada.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private _client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const url = this.config.get<string>('redis.url');
    if (!url) {
      this.logger.warn(
        'REDIS_URL no configurado → trabajando sin Redis (fallback memoria/DB).',
      );
      return;
    }

    this._client = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this._client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
    this._client.on('connect', () => {
      this.logger.log('Redis conectado');
    });
  }

  async onModuleDestroy() {
    if (this._client) {
      await this._client.quit().catch(() => undefined);
      this._client = null;
    }
  }

  /** Devuelve el cliente si está conectado y listo; null si no hay Redis o está caído. */
  get client(): Redis | null {
    if (!this._client) return null;
    // 'ready' | 'connect' | 'reconnecting' | 'end' | 'wait' | 'connecting'
    return this._client.status === 'ready' ? this._client : null;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /** Helper para intentar con Redis y fallback silencioso si falla. */
  async safeCall<T>(
    op: (redis: Redis) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    const r = this.client;
    if (!r) return { ok: false };
    try {
      return { ok: true, value: await op(r) };
    } catch (err) {
      this.logger.warn(`Redis op falló, usando fallback: ${String(err)}`);
      return { ok: false };
    }
  }
}
