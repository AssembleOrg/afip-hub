import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@/infra/redis';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate-limiter tipo fixed-window por minuto.
 *
 *  - **Con Redis** (producción multi-instancia): INCR atómico + EXPIRE al
 *    crear el bucket. Consistente entre réplicas.
 *  - **Sin Redis** (dev / redis caído): fallback a Map in-memory por proceso.
 *    Correcto pero solo dentro de esa instancia.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly memBuckets = new Map<string, Bucket>();

  constructor(private readonly redis: RedisService) {}

  async tryConsume(key: string, limitPerMin: number): Promise<boolean> {
    if (limitPerMin <= 0) return true;

    const redisResult = await this.redis.safeCall(async (r) => {
      const redisKey = `rl:${key}:${this.currentWindowSlot()}`;
      const count = await r.incr(redisKey);
      if (count === 1) {
        await r.expire(redisKey, 65);
      }
      return count;
    });

    if (redisResult.ok) {
      return redisResult.value <= limitPerMin;
    }

    return this.memConsume(key, limitPerMin);
  }

  async secondsUntilReset(key: string): Promise<number> {
    const redisResult = await this.redis.safeCall((r) =>
      r.ttl(`rl:${key}:${this.currentWindowSlot()}`),
    );
    if (redisResult.ok && redisResult.value > 0) {
      return redisResult.value;
    }
    const b = this.memBuckets.get(key);
    if (!b) return 0;
    return Math.max(0, Math.ceil((b.resetAt - Date.now()) / 1000));
  }

  private memConsume(key: string, limit: number): boolean {
    const now = Date.now();
    const b = this.memBuckets.get(key);

    if (!b || now >= b.resetAt) {
      this.memBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      this.cleanupMem(now);
      return true;
    }
    if (b.count >= limit) return false;
    b.count += 1;
    return true;
  }

  private cleanupMem(now: number) {
    if (this.memBuckets.size < 1000) return;
    for (const [k, b] of this.memBuckets) {
      if (now >= b.resetAt) this.memBuckets.delete(k);
    }
  }

  private currentWindowSlot(): number {
    return Math.floor(Date.now() / 60_000);
  }
}
