import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { addMonths } from '@/common/utils/date.util';
import { UsageKind } from '../../../generated/prisma';

export interface RecordEventParams {
  organizationId: string;
  apiKeyId?: string | null;
  endpoint: string;
  method: string;
  kind: UsageKind;
  cost: number;
  statusCode: number;
  durationMs: number;
  ip?: string | null;
  userAgent?: string | null;
}

export interface UsageSnapshot {
  billableCount: number;
  pdfCount: number;
  taCount: number;
  periodStart: Date;
  periodEnd: Date;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserta el evento (append-only, fuente de verdad) e incrementa el counter
   * denormalizado del período si el evento es exitoso (2xx) y cuenta para
   * quota. Todo transaccional para que el counter nunca se desincronice.
   *
   * Fase 2: además escribir en Redis (INCR) y mover el increment del counter a
   * un reconciliador async. Por ahora DB directo.
   */
  async recordEvent(params: RecordEventParams): Promise<void> {
    const counted =
      (params.kind === UsageKind.BILLABLE || params.kind === UsageKind.PDF) &&
      params.statusCode >= 200 &&
      params.statusCode < 300;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.usageEvent.create({
          data: {
            organizationId: params.organizationId,
            apiKeyId: params.apiKeyId ?? null,
            endpoint: params.endpoint,
            method: params.method,
            kind: params.kind,
            cost: params.cost,
            statusCode: params.statusCode,
            durationMs: params.durationMs,
            ip: params.ip?.slice(0, 45) ?? null,
            userAgent: params.userAgent?.slice(0, 500) ?? null,
          },
        });

        if (counted) {
          const counter = await this.getOrCreateCurrentCounter(
            tx,
            params.organizationId,
          );
          await tx.usageCounter.update({
            where: { id: counter.id },
            data: {
              billableCount: {
                increment:
                  params.kind === UsageKind.BILLABLE ? params.cost : 0,
              },
              pdfCount: {
                increment: params.kind === UsageKind.PDF ? params.cost : 0,
              },
              lastUpdatedAt: new Date(),
            },
          });
        } else if (params.kind === UsageKind.TA) {
          const counter = await this.getOrCreateCurrentCounter(
            tx,
            params.organizationId,
          );
          await tx.usageCounter.update({
            where: { id: counter.id },
            data: {
              taCount: { increment: 1 },
              lastUpdatedAt: new Date(),
            },
          });
        }
      });
    } catch (err) {
      // Nunca rompemos el response por un fallo al contar.
      this.logger.error(
        `Error registrando evento de uso (org=${params.organizationId} endpoint=${params.endpoint}): ${String(err)}`,
      );
    }
  }

  /**
   * Lee el counter actual del período. Si no existe (primer request del ciclo
   * o sharding edge case) lo crea en 0.
   *
   * Pensado para que la QuotaGuard pueda leer rápido sin ser transaccional.
   * Si Redis entra en escena, esto queda como fallback.
   */
  async getCurrentSnapshot(organizationId: string): Promise<UsageSnapshot> {
    const counter = await this.getOrCreateCurrentCounter(
      this.prisma,
      organizationId,
    );
    return {
      billableCount: counter.billableCount + counter.pdfCount,
      pdfCount: counter.pdfCount,
      taCount: counter.taCount,
      periodStart: counter.periodStart,
      periodEnd: counter.periodEnd,
    };
  }

  /**
   * Busca el counter del período actual o lo crea. Acepta tanto el cliente
   * Prisma principal como un `tx` para usarlo dentro de transacciones.
   *
   * IMPORTANTE: asume que el período actual coincide con el de la org. Fase 2
   * va a tener un cron que crea el counter nuevo al renovar el ciclo MP.
   */
  private async getOrCreateCurrentCounter(
    db: { organization: any; usageCounter: any },
    organizationId: string,
  ) {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { currentPeriodStart: true, currentPeriodEnd: true },
    });
    if (!org) {
      throw new Error(`Organization ${organizationId} no existe`);
    }

    let counter = await db.usageCounter.findUnique({
      where: {
        organizationId_periodStart: {
          organizationId,
          periodStart: org.currentPeriodStart,
        },
      },
    });

    if (!counter) {
      counter = await db.usageCounter.create({
        data: {
          organizationId,
          periodStart: org.currentPeriodStart,
          periodEnd: org.currentPeriodEnd,
        },
      });
    }

    return counter;
  }

  /**
   * Avanza el período de la org al siguiente ciclo y crea el counter nuevo en
   * 0. Pensado para ser llamado por el cron de MP en Fase 2 cuando se confirma
   * el cobro mensual.
   */
  async rollToNextPeriod(organizationId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new Error(`Organization ${organizationId} no existe`);

    const newStart = org.currentPeriodEnd;
    const newEnd = addMonths(newStart, 1);

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          currentPeriodStart: newStart,
          currentPeriodEnd: newEnd,
        },
      });

      await tx.usageCounter.upsert({
        where: {
          organizationId_periodStart: {
            organizationId,
            periodStart: newStart,
          },
        },
        create: {
          organizationId,
          periodStart: newStart,
          periodEnd: newEnd,
        },
        update: {},
      });
    });
  }
}
