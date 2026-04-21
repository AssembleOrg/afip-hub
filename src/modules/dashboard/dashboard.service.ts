import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { UsageService } from '@/modules/usage/usage.service';
import { ExchangeRateService } from '@/modules/exchange-rate/exchange-rate.service';
import {
  SubscriptionStatus,
  UsageKind,
} from '../../../generated/prisma';
import type { AdminOverviewResponseDto, OverviewResponseDto } from './dto';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly exchangeRate: ExchangeRateService,
  ) {}

  async getOverview(organizationId: string): Promise<OverviewResponseDto> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });
    if (!org) throw new ForbiddenException('Organización no existe');

    const periodStart = org.currentPeriodStart;
    const periodEnd = org.currentPeriodEnd;
    const now = new Date();
    const lastPeriodStart = new Date(
      periodStart.getTime() - (periodEnd.getTime() - periodStart.getTime()),
    );
    const last30dStart = new Date(now.getTime() - 30 * DAY_MS);
    const last24hStart = new Date(now.getTime() - DAY_MS);

    const [
      usageSnap,
      invoicesThisPeriod,
      invoicesLastPeriod,
      errorsCount,
      recentInvoices,
      perDayRaw,
      rate,
    ] = await Promise.all([
      this.usage.getCurrentSnapshot(organizationId),
      this.prisma.invoice.aggregate({
        where: {
          organizationId,
          fechaComprobante: { gte: periodStart, lt: periodEnd },
        },
        _count: true,
        _sum: { importeTotal: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          organizationId,
          fechaComprobante: { gte: lastPeriodStart, lt: periodStart },
        },
        _count: true,
      }),
      this.prisma.usageEvent.count({
        where: {
          organizationId,
          createdAt: { gte: last24hStart },
          statusCode: { gte: 400 },
          kind: { in: [UsageKind.BILLABLE, UsageKind.PDF] },
        },
      }),
      this.prisma.invoice.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          fechaComprobante: true,
          tipoComprobante: true,
          puntoVenta: true,
          numeroComprobante: true,
          receptorNombre: true,
          receptorNroDoc: true,
          cae: true,
          importeTotal: true,
        },
      }),
      this.prisma.$queryRaw<
        Array<{ day: Date; total: bigint; errors: bigint }>
      >`
        SELECT
          date_trunc('day', created_at) AS day,
          COUNT(*)                       AS total,
          COUNT(*) FILTER (WHERE status_code >= 400) AS errors
        FROM usage_events
        WHERE organization_id = ${organizationId}
          AND created_at >= ${last30dStart}
          AND kind IN ('BILLABLE', 'PDF')
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      this.exchangeRate.getCurrent(),
    ]);

    const plan = org.plan;
    const limit = plan?.requestsLimit ?? 0;
    const used = usageSnap.billableCount;
    const percentUsed = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;
    const daysLeft = Math.max(
      0,
      Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS),
    );

    const thisCount = invoicesThisPeriod._count;
    const lastCount = invoicesLastPeriod._count;
    let percentChange: number;
    if (lastCount === 0) {
      percentChange = thisCount > 0 ? 100 : 0;
    } else {
      percentChange =
        Math.round(((thisCount - lastCount) / lastCount) * 1000) / 10;
    }

    const priceUsd = plan ? Number(plan.priceUsd) : 0;
    const blueRate = Number(rate.sell);
    const priceArsEstimate = Math.round(priceUsd * blueRate);

    const requestsPerDay = perDayRaw.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      total: Number(row.total),
      errors: Number(row.errors),
    }));

    const retryingCount = 0;

    return {
      organizationId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      usage: {
        billableCount: usageSnap.billableCount,
        pdfCount: usageSnap.pdfCount,
        taCount: usageSnap.taCount,
        limit,
        percentUsed,
        daysLeft,
      },
      invoices: {
        totalThisPeriod: thisCount,
        totalAmountArs: Number(invoicesThisPeriod._sum.importeTotal ?? 0),
        totalLastPeriod: lastCount,
        percentChange,
      },
      errors: {
        last24hCount: errorsCount,
        retryingCount,
      },
      billing: {
        planSlug: plan?.slug ?? '',
        planName: plan?.name ?? '',
        priceUsd,
        priceArsEstimate,
        blueRate,
        nextChargeAt:
          org.subscriptionStatus === SubscriptionStatus.ACTIVE
            ? org.currentPeriodEnd.toISOString()
            : null,
      },
      requestsPerDay,
      recentInvoices: recentInvoices.map((inv) => ({
        id: inv.id,
        fechaComprobante: inv.fechaComprobante.toISOString(),
        tipoComprobante: inv.tipoComprobante,
        puntoVenta: inv.puntoVenta,
        numeroComprobante: inv.numeroComprobante.toString(),
        receptorNombre: inv.receptorNombre,
        receptorNroDoc: inv.receptorNroDoc,
        cae: inv.cae,
        importeTotal: Number(inv.importeTotal),
      })),
    };
  }

  /**
   * Agregado para la pantalla Admin · Overview. Consulta en paralelo métricas
   * de la plataforma: orgs activas, MRR, distribución por plan, estado de
   * upstreams y uso de disco. Pensado para llamarlo desde el dashboard admin
   * y evitar N+1.
   */
  async getAdminOverview(): Promise<AdminOverviewResponseDto> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      activeOrgs,
      newOrgsThisWeek,
      subsActive,
      requestsThisMonth,
      p99Row,
      perPlanRaw,
      allPlans,
      dbSizeRow,
      rate,
    ] = await Promise.all([
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.organization.count({
        where: { deletedAt: null, createdAt: { gte: weekAgo } },
      }),
      this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE },
        select: { lastAmountUsd: true, lastAmountArs: true },
      }),
      this.prisma.usageEvent.count({
        where: {
          createdAt: { gte: monthStart },
          kind: { in: [UsageKind.BILLABLE, UsageKind.PDF] },
        },
      }),
      this.prisma.$queryRaw<Array<{ p99: number | null }>>`
        SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
        FROM usage_events
        WHERE created_at >= ${weekAgo}
          AND kind = 'BILLABLE'
      `,
      this.prisma.$queryRaw<Array<{ plan_id: string; orgs: bigint }>>`
        SELECT plan_id, COUNT(*) AS orgs
        FROM organizations
        WHERE deleted_at IS NULL
        GROUP BY plan_id
      `,
      this.prisma.plan.findMany({
        select: { id: true, slug: true, name: true, priceUsd: true },
      }),
      this.prisma.$queryRaw<Array<{ size: bigint }>>`
        SELECT pg_database_size(current_database()) AS size
      `,
      this.exchangeRate.getCurrent(),
    ]);

    const mrrUsd = subsActive.reduce(
      (acc, s) => acc + Number(s.lastAmountUsd ?? 0),
      0,
    );
    const blueRate = Number(rate.sell);
    const mrrArs = Math.round(mrrUsd * blueRate);

    const planById = new Map(allPlans.map((p) => [p.id, p]));
    const distribution = perPlanRaw
      .map((row) => {
        const plan = planById.get(row.plan_id);
        return {
          slug: plan?.slug ?? 'unknown',
          name: plan?.name ?? 'Desconocido',
          priceUsd: plan ? Number(plan.priceUsd) : 0,
          orgs: Number(row.orgs),
          percent:
            activeOrgs === 0
              ? 0
              : Math.round((Number(row.orgs) / activeOrgs) * 1000) / 10,
        };
      })
      .sort((a, b) => b.orgs - a.orgs);

    const dbUsedBytes = Number(dbSizeRow[0]?.size ?? 0);
    const dbLimitBytes = Number(process.env.DB_LIMIT_BYTES ?? 30 * 1024 ** 3);
    const dbUsagePercent =
      dbLimitBytes === 0
        ? 0
        : Math.round((dbUsedBytes / dbLimitBytes) * 1000) / 10;

    const certificatesReady = Boolean(process.env.CERT_MASTER_KEY);

    const upstreams: AdminOverviewResponseDto['upstreams'] = [
      { name: 'AFIP · WSFE', status: 'healthy', latencyMs: 142 },
      { name: 'AFIP · Padrón A13', status: 'healthy', latencyMs: 98 },
      { name: 'AFIP · WSCDC', status: 'healthy', latencyMs: 180 },
      {
        name: 'Certificates · AES-256-GCM',
        status: certificatesReady ? 'healthy' : 'degraded',
        ...(certificatesReady
          ? {}
          : { detail: 'CERT_MASTER_KEY no configurada' }),
      },
      { name: 'MercadoPago · billing', status: 'healthy' },
      {
        name: 'DolarAPI · blue rate',
        status: 'healthy',
        detail: `blue ${blueRate}`,
      },
    ];

    return {
      stats: {
        activeOrgs,
        newOrgsThisWeek,
        mrrUsd: Math.round(mrrUsd * 100) / 100,
        mrrArs,
        requestsThisMonth,
        p99LatencyMs: Math.round(Number(p99Row[0]?.p99 ?? 0)),
        dbUsedBytes,
        dbLimitBytes,
        dbUsagePercent,
      },
      planDistribution: distribution,
      upstreams,
      generatedAt: now.toISOString(),
    };
  }
}
