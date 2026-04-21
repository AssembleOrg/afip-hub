import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { PlansService } from '@/modules/plans/plans.service';
import { AuditService } from '@/modules/audit/audit.service';
import { addMonths } from '@/common/utils/date.util';
import {
  AuditActor,
  OrgRole,
  SubscriptionStatus,
} from '../../../generated/prisma';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Crea la organización inicial para un usuario recién registrado. Una sola
   * org por owner (schema enforcement). El usuario queda como `OWNER`.
   */
  async createForOwner(params: {
    ownerUserId: string;
    name: string;
    slug: string;
    planSlug?: string;
  }) {
    const existing = await this.prisma.organization.findUnique({
      where: { ownerUserId: params.ownerUserId },
    });
    if (existing) {
      throw new ConflictException('El usuario ya es dueño de una organización');
    }

    const slugTaken = await this.prisma.organization.findUnique({
      where: { slug: params.slug },
    });
    if (slugTaken) {
      throw new ConflictException(`Slug "${params.slug}" ya está en uso`);
    }

    const plan = params.planSlug
      ? await this.plansService.getBySlug(params.planSlug)
      : await this.plansService.getDefault();

    const now = new Date();
    const periodEnd = addMonths(now, 1);

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: params.name,
          slug: params.slug,
          ownerUserId: params.ownerUserId,
          planId: plan.id,
          subscriptionStatus:
            Number(plan.priceUsd) === 0
              ? SubscriptionStatus.ACTIVE
              : SubscriptionStatus.TRIALING,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });

      await tx.user.update({
        where: { id: params.ownerUserId },
        data: {
          organizationId: org.id,
          orgRole: OrgRole.OWNER,
        },
      });

      await tx.usageCounter.create({
        data: {
          organizationId: org.id,
          periodStart: now,
          periodEnd,
        },
      });

      return org;
    });
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id, deletedAt: null },
      include: { plan: true },
    });
    if (!org) throw new NotFoundException('Organización no encontrada');
    return org;
  }

  async findBySlug(slug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      include: { plan: true },
    });
    if (!org || org.deletedAt) {
      throw new NotFoundException('Organización no encontrada');
    }
    return org;
  }

  /**
   * Cambia el plan de una org. Lo usamos manualmente desde el admin o desde el
   * webhook de MercadoPago cuando confirma el upgrade. El ajuste de período
   * y precios en ARS lo maneja BillingModule en Fase 2.
   */
  async changePlan(orgId: string, planSlug: string, actorUserId?: string) {
    const org = await this.findById(orgId);
    const newPlan = await this.plansService.getBySlug(planSlug);

    if (org.planId === newPlan.id) {
      throw new BadRequestException('La organización ya está en ese plan');
    }

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { planId: newPlan.id },
      include: { plan: true },
    });

    void this.audit.record({
      actorType: actorUserId ? AuditActor.USER : AuditActor.SYSTEM,
      actorUserId: actorUserId ?? null,
      organizationId: orgId,
      action: 'org.plan_changed',
      severity: 'warn',
      targetType: 'organization',
      targetId: orgId,
      changes: {
        from: org.plan.slug,
        to: newPlan.slug,
      },
    });

    return updated;
  }

  listAll(opts: { skip?: number; take?: number } = {}) {
    return this.prisma.organization.findMany({
      where: { deletedAt: null },
      include: { plan: true, _count: { select: { apiKeys: true, members: true } } },
      orderBy: { createdAt: 'desc' },
      skip: opts.skip ?? 0,
      take: Math.min(opts.take ?? 50, 200),
    });
  }

  async suspend(orgId: string, reason: string, actorUserId?: string) {
    await this.findById(orgId);
    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        suspendedAt: new Date(),
        suspendedReason: reason,
        subscriptionStatus: SubscriptionStatus.PAUSED,
      },
    });
    void this.audit.record({
      actorType: AuditActor.PLATFORM_ADMIN,
      actorUserId: actorUserId ?? null,
      organizationId: orgId,
      action: 'org.suspended',
      severity: 'error',
      targetType: 'organization',
      targetId: orgId,
      metadata: { reason },
    });
    return updated;
  }

  async reactivate(orgId: string, actorUserId?: string) {
    await this.findById(orgId);
    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        suspendedAt: null,
        suspendedReason: null,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      },
    });
    void this.audit.record({
      actorType: AuditActor.PLATFORM_ADMIN,
      actorUserId: actorUserId ?? null,
      organizationId: orgId,
      action: 'org.reactivated',
      severity: 'warn',
      targetType: 'organization',
      targetId: orgId,
    });
    return updated;
  }

  async listMembers(organizationId: string) {
    const users = await this.prisma.user.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        email: true,
        orgRole: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return { items: users };
  }

  async removeMember(organizationId: string, targetUserId: string, actorUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || target.organizationId !== organizationId) {
      throw new NotFoundException('Miembro no encontrado en la organización');
    }
    if (target.orgRole === OrgRole.OWNER) {
      throw new ForbiddenException('No se puede remover al OWNER de la organización');
    }
    await this.prisma.user.update({
      where: { id: targetUserId },
      data: { organizationId: null },
    });
    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId,
      organizationId,
      action: 'org.member_removed',
      severity: 'warn',
      targetType: 'user',
      targetId: targetUserId,
      metadata: { email: target.email },
    });
    return { ok: true };
  }
}
