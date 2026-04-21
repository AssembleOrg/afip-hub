import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AuditService } from '@/modules/audit/audit.service';
import { AuditActor, Prisma } from '../../../generated/prisma';
import { CreateAddOnDto, UpdateAddOnDto } from './dto';

@Injectable()
export class AddOnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Listado público (frontend muestra el catálogo contratable). */
  listPublic() {
    return this.prisma.addOn.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  listAll() {
    return this.prisma.addOn.findMany({ orderBy: { displayOrder: 'asc' } });
  }

  async getBySlug(slug: string) {
    const row = await this.prisma.addOn.findUnique({ where: { slug } });
    if (!row) throw new NotFoundException(`AddOn "${slug}" no encontrado`);
    return row;
  }

  async getById(id: string) {
    const row = await this.prisma.addOn.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`AddOn ${id} no encontrado`);
    return row;
  }

  async create(dto: CreateAddOnDto, actorUserId?: string) {
    try {
      const row = await this.prisma.addOn.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          description: dto.description,
          channel: dto.channel,
          priceUsd: dto.priceUsd,
          annualPriceUsd: dto.annualPriceUsd ?? dto.priceUsd * 10,
          features: (dto.features ?? {}) as Prisma.InputJsonValue,
          allowProration: dto.allowProration ?? true,
          isActive: dto.isActive ?? true,
          isPublic: dto.isPublic ?? true,
          displayOrder: dto.displayOrder ?? 0,
        },
      });

      void this.audit.record({
        actorType: AuditActor.PLATFORM_ADMIN,
        actorUserId: actorUserId ?? null,
        action: 'addon.created',
        severity: 'warn',
        targetType: 'addon',
        targetId: row.id,
        metadata: { slug: row.slug, priceUsd: row.priceUsd },
      });

      return row;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(`Ya existe un AddOn con slug "${dto.slug}"`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateAddOnDto, actorUserId?: string) {
    const before = await this.getById(id);
    const updated = await this.prisma.addOn.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.channel !== undefined && { channel: dto.channel }),
        ...(dto.priceUsd !== undefined && { priceUsd: dto.priceUsd }),
        ...(dto.annualPriceUsd !== undefined && { annualPriceUsd: dto.annualPriceUsd }),
        ...(dto.features !== undefined && { features: dto.features as Prisma.InputJsonValue }),
        ...(dto.allowProration !== undefined && { allowProration: dto.allowProration }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
      },
    });

    void this.audit.record({
      actorType: AuditActor.PLATFORM_ADMIN,
      actorUserId: actorUserId ?? null,
      action: 'addon.updated',
      severity: 'warn',
      targetType: 'addon',
      targetId: id,
      changes: { slug: before.slug, fields: dto },
    });

    return updated;
  }

  async remove(id: string, actorUserId?: string) {
    const addon = await this.getById(id);
    const activeSubs = await this.prisma.orgAddOnSubscription.count({
      where: { addonId: id, endedAt: null },
    });
    if (activeSubs > 0) {
      throw new BadRequestException(
        `No se puede eliminar: ${activeSubs} suscripción(es) activa(s). Desactivalo (isActive=false) para ocultarlo en vez de borrar.`,
      );
    }
    await this.prisma.addOn.delete({ where: { id } });

    void this.audit.record({
      actorType: AuditActor.PLATFORM_ADMIN,
      actorUserId: actorUserId ?? null,
      action: 'addon.deleted',
      severity: 'warn',
      targetType: 'addon',
      targetId: id,
      metadata: { slug: addon.slug },
    });
  }

  /**
   * Helper rápido: ¿la org tiene este addon activo? Usado por módulos downstream
   * (ej. módulo whatsapp consulta `hasActive(org, 'whatsapp-bot')`).
   */
  async hasActive(organizationId: string, slug: string): Promise<boolean> {
    const count = await this.prisma.orgAddOnSubscription.count({
      where: {
        organizationId,
        addon: { slug },
        status: { in: ['TRIALING', 'ACTIVE'] },
      },
    });
    return count > 0;
  }
}
