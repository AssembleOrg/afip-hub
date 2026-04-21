import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/database/prisma.service';
import { CertificatesService } from '@/modules/certificates/certificates.service';
import { AfipService } from '@/modules/afip/afip.service';
import { UsageService } from '@/modules/usage/usage.service';
import { EmisoresService } from '@/modules/emisores/emisores.service';
import { AuditService } from '@/modules/audit/audit.service';
import {
  AuditActor,
  ScheduledTask,
  ScheduledTaskRunStatus,
  ScheduledTaskType,
  SubscriptionStatus,
  UsageKind,
} from '../../../generated/prisma';
import { computeNext } from './schedule-helper';

const MAX_CONSECUTIVE_FAILURES = 5; // después de 5 fallos seguidos, desactivamos la task

@Injectable()
export class ScheduledTasksWorker {
  private readonly logger = new Logger(ScheduledTasksWorker.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly certs: CertificatesService,
    private readonly afip: AfipService,
    private readonly usage: UsageService,
    private readonly emisores: EmisoresService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cada minuto busca tasks con `nextRunAt <= now` y las ejecuta secuencialmente.
   * El lock en memoria (`running`) evita ejecuciones concurrentes si hay
   * overlap. En producción multi-instancia, usar Redis Lua para distributed
   * lock o PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'scheduled-tasks-tick' })
  async tick() {
    if (this.running) {
      this.logger.debug('Tick anterior aún corriendo, salteando');
      return;
    }
    this.running = true;
    try {
      const due = await this.prisma.scheduledTask.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          nextRunAt: { lte: new Date() },
        },
        take: 50, // límite por tick
        orderBy: { nextRunAt: 'asc' },
        include: { organization: true },
      });

      if (due.length === 0) return;
      this.logger.log(`Procesando ${due.length} task(s) vencidas`);

      for (const task of due) {
        await this.executeOne(task).catch((err) => {
          this.logger.error(
            `Fallo inesperado procesando task ${task.id}: ${String(err)}`,
          );
        });
      }
    } finally {
      this.running = false;
    }
  }

  private async executeOne(task: ScheduledTask & { organization: { id: string; slug: string; subscriptionStatus: SubscriptionStatus; suspendedAt: Date | null } }) {
    const started = new Date();

    // Si la org está suspendida, saltamos y avanzamos el schedule.
    if (
      task.organization.suspendedAt ||
      task.organization.subscriptionStatus === SubscriptionStatus.PAUSED ||
      task.organization.subscriptionStatus === SubscriptionStatus.CANCELED
    ) {
      await this.recordRun(task, started, ScheduledTaskRunStatus.SKIPPED, null, 'organization_suspended');
      await this.advanceNextRun(task, false);
      return;
    }

    const run = await this.prisma.scheduledTaskRun.create({
      data: {
        taskId: task.id,
        startedAt: started,
        status: ScheduledTaskRunStatus.RUNNING,
      },
    });

    try {
      // Traer cert cifrado desde DB. Si falla, el error es genuino del user o de config.
      const material = await this.certs.resolveMaterial(task.organizationId, task.certificateId);

      // Verificamos que el CUIT del cert esté registrado como Emisor validado.
      // Si no, la task falla (el user debe registrar el Emisor antes).
      const payload = task.payload as Record<string, unknown>;
      const cuit = material.cuit;
      const emisor = await this.emisores.findActiveByCuit(task.organizationId, cuit);
      if (!emisor) {
        throw new Error(
          `CUIT ${cuit} no está registrado como Emisor validado. Registralo en POST /api/emisores antes de ejecutar esta tarea.`,
        );
      }
      void this.emisores.touchUsage(emisor.id);

      const result = await this.dispatch(task, payload, material);

      const ended = new Date();
      await this.prisma.scheduledTaskRun.update({
        where: { id: run.id },
        data: {
          endedAt: ended,
          status: ScheduledTaskRunStatus.OK,
          result: result as any,
          durationMs: ended.getTime() - started.getTime(),
        },
      });

      // Registrar uso como BILLABLE para que cuente en la quota de la org.
      await this.usage.recordEvent({
        organizationId: task.organizationId,
        apiKeyId: null,
        endpoint: `/scheduled-tasks/${task.type.toLowerCase()}`,
        method: 'INTERNAL',
        kind: UsageKind.BILLABLE,
        cost: 1,
        statusCode: 200,
        durationMs: ended.getTime() - started.getTime(),
        ip: null,
        userAgent: `scheduled-task/${task.id}`,
      });

      await this.prisma.certificate.update({
        where: { id: task.certificateId },
        data: { lastUsedAt: ended, lastUsedByTaskId: task.id },
      });

      await this.advanceNextRun(task, true);

      this.logger.log(
        `Task ${task.id} (${task.type}) OK en ${ended.getTime() - started.getTime()}ms`,
      );
    } catch (err: any) {
      const ended = new Date();
      const errMsg = err?.message ?? String(err);
      await this.prisma.scheduledTaskRun.update({
        where: { id: run.id },
        data: {
          endedAt: ended,
          status: ScheduledTaskRunStatus.FAILED,
          error: errMsg.slice(0, 1000),
          durationMs: ended.getTime() - started.getTime(),
        },
      });

      const newFailures = task.consecutiveFailures + 1;
      const shouldDeactivate = newFailures >= MAX_CONSECUTIVE_FAILURES;

      await this.prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: ended,
          lastRunStatus: ScheduledTaskRunStatus.FAILED,
          consecutiveFailures: newFailures,
          ...(shouldDeactivate && { isActive: false }),
          ...(!shouldDeactivate && this.computeNextRunData(task, false)),
        },
      });

      if (shouldDeactivate) {
        void this.audit.record({
          actorType: AuditActor.SYSTEM,
          organizationId: task.organizationId,
          action: 'scheduled_task.auto_disabled',
          severity: 'error',
          targetType: 'scheduled_task',
          targetId: task.id,
          metadata: {
            reason: 'max_consecutive_failures',
            failures: newFailures,
            lastError: errMsg.slice(0, 300),
          },
        });
      }

      this.logger.error(
        `Task ${task.id} (${task.type}) FAIL (${newFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errMsg}`,
      );
    }
  }

  /** Llama el endpoint interno del AFIP service según el tipo de task. */
  private async dispatch(
    task: ScheduledTask,
    payload: Record<string, unknown>,
    material: { certificate: string; privateKey: string; cuit: string },
  ): Promise<unknown> {
    const fullPayload = {
      ...payload,
      cuitEmisor: payload.cuitEmisor ?? material.cuit,
      certificado: material.certificate,
      clavePrivada: material.privateKey,
    };

    switch (task.type) {
      case ScheduledTaskType.INVOICE:
        return this.afip.createInvoice(fullPayload as any);

      case ScheduledTaskType.CONSULTAR_CUIT: {
        const dto = fullPayload as any;
        return this.afip.consultarContribuyente({
          cuit: dto.cuitAConsultar ?? dto.cuit,
          certificado: material.certificate,
          clavePrivada: material.privateKey,
          cuitEmisor: material.cuit,
          homologacion: !!dto.homologacion,
        } as any);
      }

      case ScheduledTaskType.ULTIMO_AUTORIZADO: {
        const dto = fullPayload as any;
        const ticket = await this.afip.getTicket(
          'wsfe',
          material.certificate,
          material.privateKey,
          !!dto.homologacion,
        );
        return this.afip.getUltimoAutorizado(
          dto.puntoVenta,
          dto.tipoComprobante,
          ticket,
          material.cuit,
          !!dto.homologacion,
        );
      }

      default:
        throw new Error(`Tipo de task no soportado: ${task.type}`);
    }
  }

  private async advanceNextRun(task: ScheduledTask, success: boolean) {
    const update = this.computeNextRunData(task, success);
    await this.prisma.scheduledTask.update({
      where: { id: task.id },
      data: update,
    });
  }

  private computeNextRunData(task: ScheduledTask, success: boolean) {
    // "Una sola vez" → desactivar tras ejecutar.
    if (task.runOnce) {
      return {
        lastRunAt: new Date(),
        lastRunStatus: success ? ScheduledTaskRunStatus.OK : ScheduledTaskRunStatus.FAILED,
        nextRunAt: null,
        isActive: false,
        ...(success && { consecutiveFailures: 0 }),
      };
    }
    let nextRunAt: Date | null = null;
    try {
      nextRunAt = computeNext(task.cronExpression, task.timezone);
    } catch (err) {
      this.logger.error(
        `No puedo calcular nextRun para task ${task.id} (cron=${task.cronExpression}): ${String(err)}`,
      );
    }
    return {
      lastRunAt: new Date(),
      lastRunStatus: success ? ScheduledTaskRunStatus.OK : ScheduledTaskRunStatus.FAILED,
      nextRunAt,
      ...(success && { consecutiveFailures: 0 }),
    };
  }

  private async recordRun(
    task: ScheduledTask,
    started: Date,
    status: ScheduledTaskRunStatus,
    result: unknown,
    errorMsg: string | null,
  ) {
    const ended = new Date();
    await this.prisma.scheduledTaskRun.create({
      data: {
        taskId: task.id,
        startedAt: started,
        endedAt: ended,
        status,
        result: result as any,
        error: errorMsg,
        durationMs: ended.getTime() - started.getTime(),
      },
    });
  }

}
