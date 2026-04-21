import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { PrismaService } from '@/database/prisma.service';
import { RedisService } from '@/infra/redis';

const REDIS_KEY = 'exchange:dolarapi_blue';

/** Cotización blue de dolarapi.com */
interface DolarApiResponse {
  compra: number;
  venta: number;
  casa: string;
  nombre: string;
  moneda: string;
  fechaActualizacion: string;
}

export interface ExchangeRate {
  source: string;
  buy: number;
  sell: number;
  fetchedAt: Date;
}

@Injectable()
export class ExchangeRateService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    // Al arrancar, si no hay cotización en DB, intentamos traer una.
    // No bloqueamos el startup si falla (la API externa puede estar caída).
    try {
      const latest = await this.getLatestFromDb();
      if (!latest) {
        this.logger.log('No hay cotización en DB, trayendo inicial...');
        await this.fetchAndPersist().catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn(`No se pudo cargar cotización inicial: ${String(err)}`);
    }
  }

  /** Cron a los 0, 15, 30 y 45 de cada hora. */
  @Cron('0 */15 * * * *', { name: 'exchange-rate-refresh' })
  async scheduledRefresh() {
    try {
      await this.fetchAndPersist();
    } catch (err) {
      this.logger.error(`Falló refresh programado: ${String(err)}`);
    }
  }

  /**
   * Devuelve la cotización actual. Intenta Redis primero, luego DB, luego
   * fuerza un fetch si nada disponible.
   */
  async getCurrent(): Promise<ExchangeRate> {
    const cached = await this.getFromRedis();
    if (cached) return cached;

    const fromDb = await this.getLatestFromDb();
    if (fromDb) {
      await this.setRedis(fromDb);
      return fromDb;
    }

    // Nada en cache/DB → forzar fetch live (con timeout corto).
    return this.fetchAndPersist();
  }

  /** Valor "venta" actual — usamos esto para cobrar al cliente. */
  async getSellRate(): Promise<number> {
    const r = await this.getCurrent();
    return r.sell;
  }

  async fetchAndPersist(): Promise<ExchangeRate> {
    const url =
      this.config.get<string>('exchangeRate.source') ||
      'https://dolarapi.com/v1/dolares/blue';

    const { data } = await axios.get<DolarApiResponse>(url, { timeout: 8000 });

    if (!data || typeof data.venta !== 'number' || data.venta <= 0) {
      throw new Error(`Respuesta inválida de ${url}: ${JSON.stringify(data)}`);
    }

    const record = await this.prisma.exchangeRate.create({
      data: {
        source: 'dolarapi_blue',
        buy: data.compra,
        sell: data.venta,
        raw: data as any,
      },
    });

    const result: ExchangeRate = {
      source: record.source,
      buy: Number(record.buy),
      sell: Number(record.sell),
      fetchedAt: record.fetchedAt,
    };
    await this.setRedis(result);

    this.logger.log(
      `Cotización actualizada: compra=${result.buy} venta=${result.sell}`,
    );
    return result;
  }

  private async getLatestFromDb(): Promise<ExchangeRate | null> {
    const row = await this.prisma.exchangeRate.findFirst({
      where: { source: 'dolarapi_blue' },
      orderBy: { fetchedAt: 'desc' },
    });
    if (!row) return null;
    return {
      source: row.source,
      buy: Number(row.buy),
      sell: Number(row.sell),
      fetchedAt: row.fetchedAt,
    };
  }

  private async getFromRedis(): Promise<ExchangeRate | null> {
    const res = await this.redis.safeCall((r) => r.get(REDIS_KEY));
    if (!res.ok || !res.value) return null;
    try {
      const parsed = JSON.parse(res.value);
      return {
        source: parsed.source,
        buy: Number(parsed.buy),
        sell: Number(parsed.sell),
        fetchedAt: new Date(parsed.fetchedAt),
      };
    } catch {
      return null;
    }
  }

  private async setRedis(r: ExchangeRate): Promise<void> {
    const ttl =
      this.config.get<number>('billing.exchangeCacheSeconds') ?? 900;
    await this.redis.safeCall((client) =>
      client.set(REDIS_KEY, JSON.stringify(r), 'EX', ttl),
    );
  }
}
