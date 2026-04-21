import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { AuditActor } from '../../../generated/prisma';
import { UpdatePlanDto } from './dto';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listPublic() {
    return this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  listAll() {
    return this.prisma.plan.findMany({ orderBy: { displayOrder: 'asc' } });
  }

  async getBySlug(slug: string) {
    const plan = await this.prisma.plan.findUnique({ where: { slug } });
    if (!plan) throw new NotFoundException(`Plan "${slug}" no encontrado`);
    return plan;
  }

  async getById(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException(`Plan ${id} no encontrado`);
    return plan;
  }

  async getDefault() {
    const plan = await this.prisma.plan.findFirst({
      where: { isDefault: true, isActive: true },
    });
    if (!plan) {
      throw new NotFoundException(
        'No hay plan default configurado. Corré `pnpm prisma:seed`.',
      );
    }
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto, actorUserId?: string) {
    const before = await this.getById(id);
    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.priceUsd !== undefined && { priceUsd: dto.priceUsd }),
        ...(dto.requestsLimit !== undefined && { requestsLimit: dto.requestsLimit }),
        ...(dto.cuitLimit !== undefined && { cuitLimit: dto.cuitLimit }),
        ...(dto.pdfRateLimitPerMin !== undefined && {
          pdfRateLimitPerMin: dto.pdfRateLimitPerMin,
        }),
        ...(dto.taRateLimitPerMin !== undefined && {
          taRateLimitPerMin: dto.taRateLimitPerMin,
        }),
        ...(dto.graceFactor !== undefined && { graceFactor: dto.graceFactor }),
        ...(dto.features !== undefined && { features: dto.features as any }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
      },
    });

    void this.audit.record({
      actorType: AuditActor.PLATFORM_ADMIN,
      actorUserId: actorUserId ?? null,
      action: 'plan.updated',
      severity: 'warn',
      targetType: 'plan',
      targetId: id,
      changes: {
        slug: before.slug,
        fields: dto,
      },
    });

    return updated;
  }
}
