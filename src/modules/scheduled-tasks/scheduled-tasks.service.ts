import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { AuditActor } from '../../../generated/prisma';
import {
  CreateScheduledTaskDto,
  UpdateScheduledTaskDto,
} from './dto';
import { buildSchedule, computeNext, previewRuns } from './schedule-helper';

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(params: {
    organizationId: string;
    createdByUserId: string;
    dto: CreateScheduledTaskDto;
  }) {
    await this.assertCertOfOrg(params.organizationId, params.dto.certificateId);

    const schedule = buildSchedule({
      frequency: params.dto.frequency,
      runOnce: params.dto.runOnce,
      hour: params.dto.hour,
      minute: params.dto.minute,
      daysOfWeek: params.dto.daysOfWeek,
      dayOfMonth: params.dto.dayOfMonth,
      month: params.dto.month,
      cronExpression: params.dto.cronExpression,
      timezone: params.dto.timezone,
    });

    // Sanitizamos el payload: sacamos cert/key si vinieron (los pone el worker).
    const payload = this.sanitizePayload(params.dto.payload);

    const task = await this.prisma.scheduledTask.create({
      data: {
        organizationId: params.organizationId,
        certificateId: params.dto.certificateId,
        name: params.dto.name,
        description: params.dto.description,
        type: params.dto.type,
        cronExpression: schedule.cronExpression,
        timezone: schedule.timezone,
        runOnce: schedule.runOnce,
        payload: payload as any,
        isActive: params.dto.isActive ?? true,
        nextRunAt: schedule.nextRunAt,
        createdByUserId: params.createdByUserId,
      },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: params.createdByUserId,
      organizationId: params.organizationId,
      action: 'scheduled_task.created',
      severity: 'info',
      targetType: 'scheduled_task',
      targetId: task.id,
      metadata: {
        type: task.type,
        cron: task.cronExpression,
        nextRun: task.nextRunAt,
      },
    });

    return this.withPreview(task);
  }

  async list(organizationId: string) {
    const rows = await this.prisma.scheduledTask.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { certificate: { select: { id: true, alias: true, cuit: true } } },
    });
    return { items: rows.map((r) => this.withPreview(r)) };
  }

  async get(organizationId: string, id: string) {
    const row = await this.prisma.scheduledTask.findUnique({
      where: { id },
      include: {
        certificate: { select: { id: true, alias: true, cuit: true } },
        runs: { orderBy: { startedAt: 'desc' }, take: 20 },
      },
    });
    if (!row || row.deletedAt) throw new NotFoundException('Task no encontrada');
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException('Task de otra organización');
    }
    return this.withPreview(row);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateScheduledTaskDto,
    actorUserId?: string,
  ) {
    const existing = await this.prisma.scheduledTask.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Task no encontrada');
    }
    if (existing.organizationId !== organizationId) {
      throw new ForbiddenException('Task de otra organización');
    }

    if (dto.certificateId) {
      await this.assertCertOfOrg(organizationId, dto.certificateId);
    }

    // Recompute schedule si algún campo relevante vino en el dto.
    const mustRecomputeSchedule =
      dto.frequency !== undefined ||
      dto.cronExpression !== undefined ||
      dto.runOnce !== undefined ||
      dto.hour !== undefined ||
      dto.minute !== undefined ||
      dto.daysOfWeek !== undefined ||
      dto.dayOfMonth !== undefined ||
      dto.month !== undefined ||
      dto.timezone !== undefined;

    const data: any = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.type !== undefined && { type: dto.type }),
      ...(dto.certificateId !== undefined && { certificateId: dto.certificateId }),
      ...(dto.payload !== undefined && { payload: this.sanitizePayload(dto.payload) as any }),
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };

    if (mustRecomputeSchedule) {
      const schedule = buildSchedule({
        frequency: (dto.frequency ?? existing.runOnce ? 'once' : 'daily') as any,
        runOnce: dto.runOnce ?? (existing.runOnce?.toISOString()),
        hour: dto.hour,
        minute: dto.minute,
        daysOfWeek: dto.daysOfWeek,
        dayOfMonth: dto.dayOfMonth,
        month: dto.month,
        cronExpression: dto.cronExpression ?? existing.cronExpression,
        timezone: dto.timezone ?? existing.timezone,
      });
      data.cronExpression = schedule.cronExpression;
      data.timezone = schedule.timezone;
      data.runOnce = schedule.runOnce;
      data.nextRunAt = schedule.nextRunAt;
    }

    const updated = await this.prisma.scheduledTask.update({
      where: { id },
      data,
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: 'scheduled_task.updated',
      targetType: 'scheduled_task',
      targetId: id,
      changes: dto as any,
    });

    return this.withPreview(updated);
  }

  async toggle(organizationId: string, id: string, actorUserId?: string) {
    const existing = await this.prisma.scheduledTask.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Task no encontrada');
    }
    if (existing.organizationId !== organizationId) {
      throw new ForbiddenException('Task de otra organización');
    }

    const newActive = !existing.isActive;
    const nextRunAt =
      newActive && !existing.runOnce
        ? computeNext(existing.cronExpression, existing.timezone)
        : existing.nextRunAt;

    const updated = await this.prisma.scheduledTask.update({
      where: { id },
      data: { isActive: newActive, nextRunAt },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: newActive ? 'scheduled_task.activated' : 'scheduled_task.deactivated',
      targetType: 'scheduled_task',
      targetId: id,
    });

    return this.withPreview(updated);
  }

  async remove(organizationId: string, id: string, actorUserId?: string) {
    const existing = await this.prisma.scheduledTask.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Task no encontrada');
    }
    if (existing.organizationId !== organizationId) {
      throw new ForbiddenException('Task de otra organización');
    }
    await this.prisma.scheduledTask.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: 'scheduled_task.deleted',
      severity: 'warn',
      targetType: 'scheduled_task',
      targetId: id,
    });
  }

  /** Para UI: preview de próximas 3 ejecuciones. */
  private withPreview<T extends { cronExpression: string; timezone: string; runOnce: Date | null }>(
    task: T,
  ) {
    if (task.runOnce) return task;
    let upcoming: Date[] = [];
    try {
      upcoming = previewRuns(task.cronExpression, task.timezone, 3);
    } catch {
      upcoming = [];
    }
    return { ...task, upcoming };
  }

  private async assertCertOfOrg(orgId: string, certificateId: string) {
    const cert = await this.prisma.certificate.findUnique({
      where: { id: certificateId },
    });
    if (!cert || cert.deletedAt || cert.organizationId !== orgId) {
      throw new BadRequestException(
        'certificateId no existe o no pertenece a tu organización',
      );
    }
    if (!cert.isActive) {
      throw new BadRequestException('El certificado está inactivo');
    }
    if (cert.notAfter.getTime() < Date.now()) {
      throw new BadRequestException('El certificado está vencido');
    }
  }

  /**
   * Nunca aceptamos cert/clave en el payload guardado — si el user los manda
   * por error, los sacamos y logueamos warning. El cert vive cifrado en DB.
   */
  private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = { ...payload };
    let stripped = false;
    for (const k of ['certificado', 'clavePrivada', 'certificate', 'privateKey']) {
      if (k in clean) {
        delete clean[k];
        stripped = true;
      }
    }
    if (stripped) {
      this.logger.warn(
        'Payload de ScheduledTask incluía cert/clave. Fueron removidos; el cert persistido cifrado es la única fuente.',
      );
    }
    return clean;
  }
}
