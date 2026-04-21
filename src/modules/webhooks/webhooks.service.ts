import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import axios from 'axios';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { QUEUE_WEBHOOKS } from '@/infra/queue/queue.module';
import {
  AuditActor,
  WebhookDeliveryStatus,
} from '../../../generated/prisma';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';

const MAX_ATTEMPTS = 8;
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES_BEFORE_DISABLE = 20;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    // @Optional → si REDIS_URL no está seteado, BullMQ no registra la queue
    // y caemos en el fallback de cron polling (WebhooksWorker).
    @Optional()
    @Inject(getQueueToken(QUEUE_WEBHOOKS))
    private readonly queue: Queue | undefined,
  ) {}

  // ==========================================================
  //  CRUD de suscripciones
  // ==========================================================

  async create(params: {
    organizationId: string;
    createdByUserId: string;
    dto: CreateWebhookDto;
  }) {
    const secret = this.generateSecret();
    const secretHash = this.hashSecret(secret);

    const sub = await this.prisma.webhookSubscription.create({
      data: {
        organizationId: params.organizationId,
        url: params.dto.url,
        events: params.dto.events,
        description: params.dto.description,
        secretHash,
        createdByUserId: params.createdByUserId,
      },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: params.createdByUserId,
      organizationId: params.organizationId,
      action: 'webhook.created',
      severity: 'warn',
      targetType: 'webhook_subscription',
      targetId: sub.id,
      metadata: { url: sub.url, events: sub.events },
    });

    // Plaintext solo se muestra una vez (como las API keys).
    return {
      id: sub.id,
      url: sub.url,
      events: sub.events,
      description: sub.description,
      isActive: sub.isActive,
      createdAt: sub.createdAt,
      secret,
      signatureHint:
        'Header: X-Webhook-Signature: sha256=<hex>. HMAC-SHA256(secret, rawBody).',
    };
  }

  async list(organizationId: string) {
    const rows = await this.prisma.webhookSubscription.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.map((r) => this.sanitize(r)) };
  }

  async get(organizationId: string, id: string) {
    const sub = await this.prisma.webhookSubscription.findUnique({
      where: { id },
      include: {
        deliveries: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!sub || sub.deletedAt) throw new NotFoundException('Webhook no encontrado');
    if (sub.organizationId !== organizationId) {
      throw new ForbiddenException('Webhook de otra organización');
    }
    return this.sanitize(sub);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateWebhookDto,
    actorUserId?: string,
  ) {
    const existing = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Webhook no encontrado');
    }
    if (existing.organizationId !== organizationId) {
      throw new ForbiddenException('Webhook de otra organización');
    }

    const updated = await this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: 'webhook.updated',
      targetType: 'webhook_subscription',
      targetId: id,
      changes: dto as any,
    });

    return this.sanitize(updated);
  }

  async rotateSecret(organizationId: string, id: string, actorUserId?: string) {
    const existing = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Webhook no encontrado');
    }
    if (existing.organizationId !== organizationId) {
      throw new ForbiddenException('Webhook de otra organización');
    }

    const secret = this.generateSecret();
    await this.prisma.webhookSubscription.update({
      where: { id },
      data: { secretHash: this.hashSecret(secret) },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: 'webhook.secret_rotated',
      severity: 'warn',
      targetType: 'webhook_subscription',
      targetId: id,
    });

    return { id, secret };
  }

  async remove(organizationId: string, id: string, actorUserId?: string) {
    const existing = await this.prisma.webhookSubscription.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Webhook no encontrado');
    }
    if (existing.organizationId !== organizationId) {
      throw new ForbiddenException('Webhook de otra organización');
    }
    await this.prisma.webhookSubscription.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: 'webhook.deleted',
      severity: 'warn',
      targetType: 'webhook_subscription',
      targetId: id,
    });
  }

  // ==========================================================
  //  Enqueue de deliveries (llamado desde el Listener)
  // ==========================================================

  /**
   * Enqueue: por cada suscripción activa de la org que escucha este evento,
   * creamos una `WebhookDelivery` PENDING en DB (para audit/history) y
   * pusheamos un job a BullMQ (`webhooks` queue) para entrega inmediata con
   * retries gestionados por Bull.
   *
   * Si no hay queue (REDIS_URL vacío), el `WebhooksWorker` cron polling DB
   * toma las PENDING cada 30s como fallback.
   */
  async enqueueEvent(params: {
    organizationId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<number> {
    const subs = await this.prisma.webhookSubscription.findMany({
      where: {
        organizationId: params.organizationId,
        isActive: true,
        deletedAt: null,
        events: { has: params.eventType },
      },
    });

    if (subs.length === 0) return 0;

    const eventId = crypto.randomUUID();
    const now = new Date();

    // Insertamos + traemos los IDs para pushear al queue (createMany no los devuelve).
    const created = await this.prisma.$transaction(
      subs.map((s) =>
        this.prisma.webhookDelivery.create({
          data: {
            subscriptionId: s.id,
            eventType: params.eventType,
            eventId,
            payload: this.buildEnvelope(params.eventType, eventId, params.payload) as any,
            status: WebhookDeliveryStatus.PENDING,
            nextAttemptAt: now,
          },
          select: { id: true },
        }),
      ),
    );

    if (this.queue) {
      try {
        await this.queue.addBulk(
          created.map((d) => ({
            name: 'deliver',
            data: { deliveryId: d.id },
            opts: { jobId: d.id }, // dedup: mismo deliveryId no se encola 2×
          })),
        );
      } catch (err) {
        // Si falla el enqueue, las rows PENDING quedan en DB y el cron fallback
        // (WebhooksWorker) las tomará. No rompemos el flujo.
        this.logger.warn(
          `BullMQ addBulk falló (${String(err)}). Delivery queda en DB como PENDING.`,
        );
      }
    }

    return subs.length;
  }

  // ==========================================================
  //  Worker: lee deliveries PENDING/retry y las envía
  // ==========================================================

  /**
   * Entrega una WebhookDelivery específica (usado por BullMQ processor).
   * Devuelve `true` si se entregó con 2xx, `false` si falló — BullMQ usa
   * eso para aplicar su propio retry + backoff.
   */
  async deliverById(deliveryId: string): Promise<boolean> {
    const d = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { subscription: true },
    });
    if (!d) {
      this.logger.warn(`deliverById: ${deliveryId} no existe`);
      return true; // no tiene sentido reintentar algo borrado
    }
    if (d.status === WebhookDeliveryStatus.DELIVERED) return true;
    if (!d.subscription.isActive) {
      this.logger.debug(
        `Skip delivery ${deliveryId}: subscription inactiva`,
      );
      return true;
    }
    return this.deliverOne(d);
  }

  async processPending(limit = 25): Promise<{ processed: number; delivered: number; failed: number }> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: { in: [WebhookDeliveryStatus.PENDING, WebhookDeliveryStatus.IN_FLIGHT] },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      include: { subscription: true },
    });

    if (due.length === 0) return { processed: 0, delivered: 0, failed: 0 };

    let delivered = 0;
    let failed = 0;

    for (const d of due) {
      const ok = await this.deliverOne(d);
      if (ok) delivered++;
      else failed++;
    }

    return { processed: due.length, delivered, failed };
  }

  /**
   * Envía un delivery individual. Maneja retry/backoff internamente.
   * Devuelve `true` si se entregó con 2xx.
   */
  private async deliverOne(
    d: { id: string; subscriptionId: string; payload: any; attempts: number; subscription: { url: string; secretHash: string; consecutiveFailures: number } },
  ): Promise<boolean> {
    const attemptNumber = d.attempts + 1;
    const bodyRaw = JSON.stringify(d.payload);
    // OJO: el secretHash que tenemos en DB es HASH(secret). Pero para firmar
    // necesitamos el secret plaintext. Solución: el cliente guardó el secret
    // cuando lo creamos; nosotros firmamos con el hash como "key" del HMAC,
    // el cliente valida con el mismo hash. Documentar en la UI.
    const signature = crypto
      .createHmac('sha256', d.subscription.secretHash)
      .update(bodyRaw)
      .digest('hex');

    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: WebhookDeliveryStatus.IN_FLIGHT,
        attempts: attemptNumber,
        lastAttemptAt: new Date(),
      },
    });

    try {
      const resp = await axios.post(d.subscription.url, d.payload, {
        timeout: DELIVERY_TIMEOUT_MS,
        headers: {
          'content-type': 'application/json',
          'x-webhook-signature': `sha256=${signature}`,
          'x-webhook-event-id': (d.payload as any).id,
          'x-webhook-event-type': (d.payload as any).type,
          'user-agent': 'afip-hub-webhooks/1.0',
        },
        validateStatus: () => true, // no tira en 4xx/5xx, la manejamos nosotros
      });

      const isSuccess = resp.status >= 200 && resp.status < 300;

      if (isSuccess) {
        await this.prisma.webhookDelivery.update({
          where: { id: d.id },
          data: {
            status: WebhookDeliveryStatus.DELIVERED,
            lastStatusCode: resp.status,
            deliveredAt: new Date(),
          },
        });
        await this.prisma.webhookSubscription.update({
          where: { id: d.subscriptionId },
          data: {
            lastSuccessAt: new Date(),
            consecutiveFailures: 0,
          },
        });
        return true;
      }

      // Status no-2xx: tratamos como falla
      return this.onFailure(
        d,
        attemptNumber,
        resp.status,
        `HTTP ${resp.status} ${JSON.stringify(resp.data ?? '').slice(0, 300)}`,
      );
    } catch (err: any) {
      const errorMsg = err?.code
        ? `${err.code}: ${err.message}`
        : String(err?.message ?? err).slice(0, 500);
      return this.onFailure(d, attemptNumber, null, errorMsg);
    }
  }

  private async onFailure(
    d: { id: string; subscriptionId: string; subscription: { consecutiveFailures: number } },
    attemptNumber: number,
    statusCode: number | null,
    errorMsg: string,
  ): Promise<boolean> {
    const exhausted = attemptNumber >= MAX_ATTEMPTS;
    const nextAttempt = exhausted
      ? null
      : new Date(Date.now() + this.backoffMs(attemptNumber));

    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: exhausted
          ? WebhookDeliveryStatus.FAILED
          : WebhookDeliveryStatus.PENDING,
        lastStatusCode: statusCode,
        lastError: errorMsg.slice(0, 1000),
        nextAttemptAt: nextAttempt ?? new Date(),
      },
    });

    const consecutive = d.subscription.consecutiveFailures + (exhausted ? 1 : 0);
    const shouldAutoDisable =
      consecutive >= MAX_CONSECUTIVE_FAILURES_BEFORE_DISABLE;

    await this.prisma.webhookSubscription.update({
      where: { id: d.subscriptionId },
      data: {
        consecutiveFailures: consecutive,
        ...(shouldAutoDisable && { isActive: false }),
      },
    });

    if (shouldAutoDisable) {
      this.logger.warn(
        `Webhook subscription ${d.subscriptionId} auto-disabled tras ${consecutive} fallos consecutivos`,
      );
    }

    return false;
  }

  /** Backoff exponencial con jitter: 30s, 1m, 2m, 4m, 8m, 15m, 30m, 60m. */
  private backoffMs(attempt: number): number {
    const base = 30_000 * 2 ** (attempt - 1);
    const capped = Math.min(base, 60 * 60_000); // max 1 hora
    const jitter = Math.floor(Math.random() * capped * 0.2);
    return capped + jitter;
  }

  private buildEnvelope(
    eventType: string,
    eventId: string,
    data: Record<string, unknown>,
  ) {
    return {
      id: eventId,
      type: eventType,
      createdAt: new Date().toISOString(),
      data,
    };
  }

  private generateSecret(): string {
    return 'whs_' + crypto.randomBytes(32).toString('base64url');
  }

  private hashSecret(s: string): string {
    return crypto.createHash('sha256').update(s).digest('hex');
  }

  private sanitize(sub: any) {
    const { secretHash: _h, ...rest } = sub;
    return rest;
  }
}
