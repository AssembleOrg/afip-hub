import {
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '@/database/prisma.service';
import { Prisma } from '../../../generated/prisma';

const TTL_HOURS = 24;

export interface CachedResponse {
  statusCode: number;
  body: unknown;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  hashBody(body: unknown): string {
    const stable = this.stableStringify(body ?? null);
    return crypto.createHash('sha256').update(stable).digest('hex');
  }

  /**
   * Consulta si hay respuesta cacheada para esa key. Tres casos:
   *  - No existe → null (proceder normalmente)
   *  - Existe con mismo bodyHash → devuelve respuesta cacheada (replay)
   *  - Existe con bodyHash distinto → lanza 409 (mismo key con cuerpo distinto)
   */
  async lookup(params: {
    organizationId: string;
    key: string;
    bodyHash: string;
  }): Promise<CachedResponse | null> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: {
        organizationId_key: {
          organizationId: params.organizationId,
          key: params.key,
        },
      },
    });

    if (!existing) return null;

    if (existing.expiresAt < new Date()) {
      // expirada → la borramos perezosamente y procedemos
      await this.prisma.idempotencyKey.delete({ where: { id: existing.id } }).catch(() => undefined);
      return null;
    }

    if (existing.bodyHash !== params.bodyHash) {
      throw new ConflictException({
        error: 'idempotency_conflict',
        message:
          'Idempotency-Key reutilizada con body distinto. Usá una key nueva o repetí el body original.',
      });
    }

    return {
      statusCode: existing.statusCode,
      body: existing.responseBody as unknown,
    };
  }

  async store(params: {
    organizationId: string;
    key: string;
    endpoint: string;
    method: string;
    bodyHash: string;
    statusCode: number;
    responseBody: unknown;
  }): Promise<void> {
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          organizationId: params.organizationId,
          key: params.key,
          endpoint: params.endpoint,
          method: params.method,
          bodyHash: params.bodyHash,
          statusCode: params.statusCode,
          responseBody: this.serializableBody(params.responseBody) as any,
          expiresAt,
        },
      });
    } catch (err) {
      // Race condition: dos requests con misma key llegaron al mismo tiempo.
      // Es benigno: el primero ya cacheó, ignoramos.
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        this.logger.warn(`No se pudo guardar idempotency key: ${String(err)}`);
      }
    }
  }

  /** Cron diario: borra keys expiradas. */
  async purgeExpired(): Promise<number> {
    const r = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    return r.count;
  }

  /** JSON estable (claves ordenadas) para que mismo objeto en orden distinto produzca mismo hash. */
  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.stableStringify(v)).join(',') + ']';
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ':' + this.stableStringify(obj[k]),
    );
    return '{' + parts.join(',') + '}';
  }

  /** Garantiza que el body sea JSON serializable. Si no, guarda repr. */
  private serializableBody(body: unknown): unknown {
    if (body === undefined || body === null) return null;
    if (typeof body === 'string' || typeof body === 'number' || typeof body === 'boolean') {
      return body;
    }
    try {
      JSON.stringify(body);
      return body;
    } catch {
      return { _nonSerializable: true, repr: String(body) };
    }
  }
}
