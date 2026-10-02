import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { EmailService } from '@/modules/email/email.service';
import { formatLocal } from '@/common/utils/clock';
import { PlatformRole, UsageKind } from '../../../generated/prisma';

/** Ventana que miramos en cada chequeo. */
const WINDOW_MIN = 15;
/** Mínimo de fallas 5xx en la ventana para considerar incidente (evita ruido con poco tráfico). */
const MIN_ERRORS = 10;
/** Proporción de fallas sobre los intentos de la ventana. */
const MIN_ERROR_RATE = 0.2;
/** No repetimos el aviso de un incidente abierto más de una vez por hora. */
const REALERT_MS = 60 * 60 * 1000;

export interface IncidentSnapshot {
  attempts: number;
  errors: number;
  errorRate: number;
  byEndpoint: Array<{ endpoint: string; errors: number }>;
  byOrg: Array<{ name: string; errors: number }>;
}

/**
 * Detecta fallas de nuestro lado (5xx: servidor caído, ARCA no responde) en
 * las llamadas de los clientes y avisa por email a los platform admins: una
 * vez al abrirse el incidente, recordatorio cada hora y aviso al resolverse.
 *
 * El estado vive en memoria (una sola instancia). Si el proceso reinicia en
 * medio de un incidente, como mucho llega un aviso de más.
 */
@Injectable()
export class IncidentAlertsService {
  private readonly logger = new Logger(IncidentAlertsService.name);
  private openSince: Date | null = null;
  private lastAlertAt = 0;
  private peakErrors = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async snapshot(now = new Date()): Promise<IncidentSnapshot> {
    const since = new Date(now.getTime() - WINDOW_MIN * 60 * 1000);
    const kinds = [UsageKind.BILLABLE, UsageKind.CONSULTA, UsageKind.PDF];

    const [attempts, errors, byEndpoint, byOrgRaw] = await Promise.all([
      this.prisma.usageEvent.count({ where: { createdAt: { gte: since }, kind: { in: kinds } } }),
      this.prisma.usageEvent.count({
        where: { createdAt: { gte: since }, kind: { in: kinds }, statusCode: { gte: 500 } },
      }),
      this.prisma.usageEvent.groupBy({
        by: ['endpoint'],
        where: { createdAt: { gte: since }, kind: { in: kinds }, statusCode: { gte: 500 } },
        _count: { _all: true },
        orderBy: { _count: { endpoint: 'desc' } },
        take: 5,
      }),
      this.prisma.usageEvent.groupBy({
        by: ['organizationId'],
        where: { createdAt: { gte: since }, kind: { in: kinds }, statusCode: { gte: 500 } },
        _count: { _all: true },
        orderBy: { _count: { organizationId: 'desc' } },
        take: 5,
      }),
    ]);

    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: byOrgRaw.map((o) => o.organizationId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(orgs.map((o) => [o.id, o.name]));

    return {
      attempts,
      errors,
      errorRate: attempts > 0 ? errors / attempts : 0,
      byEndpoint: byEndpoint.map((e) => ({ endpoint: e.endpoint, errors: e._count._all })),
      byOrg: byOrgRaw.map((o) => ({
        name: nameOf.get(o.organizationId) ?? o.organizationId,
        errors: o._count._all,
      })),
    };
  }

  isIncident(s: IncidentSnapshot): boolean {
    return s.errors >= MIN_ERRORS && s.errorRate >= MIN_ERROR_RATE;
  }

  async check(now = new Date()): Promise<void> {
    const s = await this.snapshot(now);
    const incident = this.isIncident(s);

    if (incident) {
      this.peakErrors = Math.max(this.peakErrors, s.errors);
      const isNew = !this.openSince;
      if (isNew) this.openSince = now;
      if (isNew || now.getTime() - this.lastAlertAt >= REALERT_MS) {
        this.lastAlertAt = now.getTime();
        this.logger.warn(
          `Incidente: ${s.errors} fallas 5xx de ${s.attempts} intentos en ${WINDOW_MIN} min`,
        );
        await this.notify('open', s, now);
      }
      return;
    }

    if (this.openSince) {
      this.logger.log('Incidente resuelto: fallas 5xx bajo el umbral');
      await this.notify('resolved', s, now);
      this.openSince = null;
      this.lastAlertAt = 0;
      this.peakErrors = 0;
    }
  }

  private async notify(state: 'open' | 'resolved', s: IncidentSnapshot, now: Date) {
    const admins = await this.prisma.user.findMany({
      where: { platformRole: PlatformRole.ADMIN, deletedAt: null },
      select: { email: true },
    });
    if (admins.length === 0) {
      this.logger.warn('Incidente sin platform admins a quien avisar');
      return;
    }

    const productName = this.config.get<string>('branding.productName') ?? 'AFIP Hub';
    const open = state === 'open';
    const subject = open
      ? `⚠️ ${productName}: ${s.errors} fallas en ${WINDOW_MIN} min (${Math.round(s.errorRate * 100)}%)`
      : `✅ ${productName}: se normalizaron las fallas`;

    for (const admin of admins) {
      try {
        await this.email.sendTemplate({
          to: admin.email,
          subject,
          template: 'incident-alert',
          preheader: open
            ? 'Clientes recibiendo errores 5xx al emitir o consultar'
            : 'Las llamadas volvieron a responder bien',
          data: {
            open,
            windowMin: WINDOW_MIN,
            errors: s.errors,
            attempts: s.attempts,
            errorRatePct: Math.round(s.errorRate * 100),
            peakErrors: this.peakErrors,
            since: this.openSince ? formatLocal(this.openSince, 'datetime') : null,
            checkedAt: formatLocal(now, 'datetime'),
            byEndpoint: s.byEndpoint,
            byOrg: s.byOrg,
          },
        });
      } catch (err) {
        this.logger.error(`No se pudo avisar el incidente a ${admin.email}: ${String(err)}`);
      }
    }
  }
}
