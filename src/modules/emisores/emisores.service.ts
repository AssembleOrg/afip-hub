import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { CertificatesService } from '@/modules/certificates/certificates.service';
import { AfipService } from '@/modules/afip/afip.service';
import { AuditService } from '@/modules/audit/audit.service';
import { PlatformCertService } from '@/modules/platform-cert/platform-cert.service';
import {
  AuditActor,
  EmisorCertMode,
  EmisorValidationStatus,
  Prisma,
} from '../../../generated/prisma';
import { CreateEmisorDto, UpdateEmisorDto, ListEmisoresDto, mapEmisorToResponse } from './dto';

// Slot ocupado hasta 28 días después del soft-delete.
const SLOT_RETENTION_DAYS = 28;

@Injectable()
export class EmisoresService {
  private readonly logger = new Logger(EmisoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: CertificatesService,
    private readonly afip: AfipService,
    private readonly audit: AuditService,
    private readonly platformCert: PlatformCertService,
  ) {}

  /**
   * Registra un Emisor y valida contra AFIP que el cert tenga permiso para
   * operar como ese CUIT. Si no lo tiene, AFIP rechaza y no persistimos.
   *
   * El slot ocupado (contra plan.cuitLimit) incluye emisores soft-deleted
   * dentro de los últimos 28d para prevenir abuso de create/delete.
   */
  async create(params: {
    organizationId: string;
    createdByUserId: string;
    dto: CreateEmisorDto;
    cuitLimit: number;
    planSlug: string;
  }) {
    const cuit = params.dto.cuit.replace(/[^\d]/g, '');
    if (!/^\d{11}$/.test(cuit)) {
      throw new BadRequestException('CUIT inválido: deben ser 11 dígitos');
    }

    // ¿Ya existe (activo o soft-deleted dentro de ventana)?
    const existing = await this.prisma.emisor.findUnique({
      where: {
        organizationId_cuit: {
          organizationId: params.organizationId,
          cuit,
        },
      },
    });

    if (existing && !existing.deletedAt) {
      throw new BadRequestException(
        `El emisor ${cuit} ya está registrado en tu organización`,
      );
    }

    // Chequeo de slots: cuenta activos + soft-deleted dentro de 28d.
    const usedSlots = await this.countSlotsInUse(params.organizationId);
    const availableSlots = params.cuitLimit - usedSlots;
    if (availableSlots <= 0) {
      throw new ForbiddenException({
        error: 'cuit_limit_exceeded',
        message: `Tu plan "${params.planSlug}" permite ${params.cuitLimit} emisores. Ya usaste ${usedSlots} (incluyendo emisores borrados en los últimos ${SLOT_RETENTION_DAYS} días).`,
        usedSlots,
        cuitLimit: params.cuitLimit,
        plan: params.planSlug,
      });
    }

    // Resolvemos el cert a usar según el modo elegido.
    let certId: string | null = null;
    let certMode: EmisorCertMode;
    let certForValidation: { certificate: string; privateKey: string };

    const homologacion = params.dto.homologacion ?? false;

    if (params.dto.mode === 'platform') {
      // Modo maestro SaaS: el emisor delegó al CUIT de la plataforma en AFIP.
      certMode = EmisorCertMode.PLATFORM;
      certId = null;
      const master = await this.platformCert.getMaterial();
      if (!master) {
        throw new BadRequestException(
          'Modo plataforma no disponible: cert maestro no configurado. Cargalo en Configuración → Cert maestro.',
        );
      }
      certForValidation = { certificate: master.certificate, privateKey: master.privateKey };
    } else {
      // Modo cuenta: usa un cert de la cuenta (existente o nuevo).
      certMode = EmisorCertMode.ACCOUNT;
      if (params.dto.certificateId) {
        // Cert ya existente en la cuenta → solo lo vinculamos.
        const material = await this.certificates.resolveMaterial(
          params.organizationId,
          params.dto.certificateId,
        );
        certId = params.dto.certificateId;
        certForValidation = { certificate: material.certificate, privateKey: material.privateKey };
      } else if (params.dto.crtFile && params.dto.keyFile) {
        // Cert nuevo subido inline → lo creamos y vinculamos.
        const certificate = this.decodePemField(params.dto.crtFile);
        const privateKey = this.decodePemField(params.dto.keyFile);
        const certRecord = await this.certificates.create({
          organizationId: params.organizationId,
          createdByUserId: params.createdByUserId,
          dto: { alias: `AFIP ${cuit}`, certificate, privateKey },
        });
        certId = certRecord.id;
        certForValidation = { certificate, privateKey };
      } else {
        throw new BadRequestException(
          'mode=account requiere certificateId (cert existente) o crtFile+keyFile (cert nuevo).',
        );
      }
    }

    // Validación AFIP: FEParamGetPtosVenta con cuitRepresentada = nuevoCuit.
    let validationStatus: EmisorValidationStatus = EmisorValidationStatus.PENDING;
    let validatedAt: Date | null = null;
    let validationError: string | null = null;
    let validationErrorCode: string | null = null;

    try {
      await this.afip.getPuntosVenta(
        cuit,
        certForValidation.certificate,
        certForValidation.privateKey,
        homologacion,
      );
      validationStatus = EmisorValidationStatus.VALIDATED;
      validatedAt = new Date();
    } catch (err: any) {
      validationStatus = EmisorValidationStatus.FAILED;
      validationError = this.extractAfipError(err);
      validationErrorCode = this.extractAfipErrorCode(err);
      this.logger.warn(
        `Validación AFIP falló para org=${params.organizationId} cuit=${cuit}: ${validationError}`,
      );
      throw new UnprocessableEntityException({
        error: 'afip_authorization_failed',
        message: `AFIP rechazó la validación para el CUIT ${cuit}. Detalle: ${validationError}`,
        afipError: validationError,
        afipErrorCode: validationErrorCode,
      });
    }

    // Upsert: si ya existía soft-deleted, lo "resurrecciono"; si no, creo nuevo.
    const row = await this.prisma.emisor.upsert({
      where: {
        organizationId_cuit: {
          organizationId: params.organizationId,
          cuit,
        },
      },
      create: {
        organizationId: params.organizationId,
        cuit,
        razonSocial: params.dto.razonSocial ?? null,
        condicionIva: params.dto.condicionIva ?? null,
        alias: params.dto.alias ?? null,
        puntoVenta: params.dto.puntoVenta,
        certMode,
        certificateId: certId,
        validationStatus,
        validatedAt,
        validationError,
        validationErrorCode,
        createdByUserId: params.createdByUserId,
      },
      update: {
        deletedAt: null,
        razonSocial: params.dto.razonSocial ?? existing?.razonSocial ?? null,
        condicionIva: params.dto.condicionIva ?? existing?.condicionIva ?? null,
        alias: params.dto.alias ?? existing?.alias ?? null,
        puntoVenta: params.dto.puntoVenta ?? existing?.puntoVenta ?? null,
        certMode,
        certificateId: certId,
        validationStatus,
        validatedAt,
        validationError,
        validationErrorCode,
      },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: params.createdByUserId,
      organizationId: params.organizationId,
      action: 'emisor.created',
      targetType: 'emisor',
      targetId: row.id,
      metadata: { cuit, certMode, certificateId: certId },
    });

    const full = await this.prisma.emisor.findUnique({
      where: { id: row.id },
      include: { certificate: { select: { alias: true, notAfter: true } } },
    });
    return mapEmisorToResponse(full ?? row);
  }

  async list(organizationId: string, query: ListEmisoresDto) {
    const where: Prisma.EmisorWhereInput = { organizationId };
    if (!query.includeDeleted) where.deletedAt = null;
    if (query.q) {
      where.OR = [
        { cuit: { contains: query.q } },
        { razonSocial: { contains: query.q, mode: 'insensitive' } },
        { alias: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const skip = query.skip ?? 0;
    const take = Math.min(query.take ?? 20, 100);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.emisor.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take,
        include: { certificate: { select: { alias: true, notAfter: true } } },
      }),
      this.prisma.emisor.count({ where }),
    ]);

    return {
      items: items.map((r) => mapEmisorToResponse(r)),
      total,
      page: take > 0 ? Math.floor(skip / take) + 1 : 1,
      pageSize: take,
    };
  }

  async findOne(organizationId: string, id: string) {
    const row = await this.prisma.emisor.findUnique({
      where: { id },
      include: { certificate: { select: { alias: true, notAfter: true } } },
    });
    if (!row) throw new NotFoundException('Emisor no encontrado');
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException('El emisor pertenece a otra organización');
    }
    return mapEmisorToResponse(row);
  }

  /** Internal: returns raw Prisma row (with deletedAt, etc.) without mapping. */
  private async findOneRaw(organizationId: string, id: string) {
    const row = await this.prisma.emisor.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Emisor no encontrado');
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException('El emisor pertenece a otra organización');
    }
    return row;
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateEmisorDto,
    actorUserId: string,
  ) {
    const row = await this.findOneRaw(organizationId, id);
    if (row.deletedAt) {
      throw new BadRequestException('El emisor está borrado — no se puede editar');
    }

    const updated = await this.prisma.emisor.update({
      where: { id },
      data: {
        alias: dto.alias === undefined ? row.alias : dto.alias,
        razonSocial: dto.razonSocial === undefined ? row.razonSocial : dto.razonSocial,
      },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId,
      organizationId,
      action: 'emisor.updated',
      targetType: 'emisor',
      targetId: id,
      metadata: { cuit: row.cuit },
    });

    return mapEmisorToResponse(updated);
  }

  /**
   * Soft-delete. El slot sigue ocupado 28 días. Re-crear el mismo CUIT
   * dentro de ese lapso "resurrecciona" el registro sin liberar ni consumir
   * otro slot.
   */
  async remove(organizationId: string, id: string, actorUserId: string) {
    const row = await this.findOneRaw(organizationId, id);
    if (row.deletedAt) return mapEmisorToResponse(row);

    const updated = await this.prisma.emisor.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId,
      organizationId,
      action: 'emisor.deleted',
      severity: 'warn',
      targetType: 'emisor',
      targetId: id,
      metadata: {
        cuit: row.cuit,
        slotReleaseAt: new Date(Date.now() + SLOT_RETENTION_DAYS * 86400_000),
      },
    });

    return mapEmisorToResponse(updated);
  }

  /**
   * Usado por CuitLimitGuard: devuelve el Emisor activo para el CUIT dado.
   * Si no existe, lo auto-registra consumiendo un slot (sin validación AFIP
   * previa — el resultado real lo decide AFIP cuando procesa el request).
   * Si el plan ya no tiene slots disponibles lanza ForbiddenException.
   */
  async findOrAutoRegister(
    organizationId: string,
    cuit: string,
    cuitLimit: number,
    planSlug: string,
  ) {
    const clean = cuit.replace(/[^\d]/g, '');
    if (!/^\d{11}$/.test(clean)) return null;

    const existing = await this.prisma.emisor.findFirst({
      where: { organizationId, cuit: clean, deletedAt: null },
    });
    if (existing) return existing;

    const usedSlots = await this.countSlotsInUse(organizationId);
    if (usedSlots >= cuitLimit) {
      throw new ForbiddenException({
        error: 'cuit_limit_exceeded',
        message: `Tu plan "${planSlug}" permite ${cuitLimit} emisores. Ya usaste ${usedSlots}. Actualizá tu plan para agregar más CUITs.`,
        usedSlots,
        cuitLimit,
        plan: planSlug,
      });
    }

    const row = await this.prisma.emisor.create({
      data: {
        organizationId,
        cuit: clean,
        certMode: EmisorCertMode.ACCOUNT,
        validationStatus: EmisorValidationStatus.VALIDATED,
        validatedAt: new Date(),
      },
    });

    this.logger.log(`Auto-registrado emisor ${clean} para org=${organizationId} (slot ${usedSlots + 1}/${cuitLimit})`);
    return row;
  }

  /**
   * @deprecated Usar findOrAutoRegister.
   * Mantenido para compatibilidad hasta migrar todos los call-sites.
   */
  async findActiveByCuit(organizationId: string, cuit: string) {
    const clean = cuit.replace(/[^\d]/g, '');
    if (!/^\d{11}$/.test(clean)) return null;
    return this.prisma.emisor.findFirst({
      where: {
        organizationId,
        cuit: clean,
        deletedAt: null,
        validationStatus: EmisorValidationStatus.VALIDATED,
      },
    });
  }

  /** Incrementa contadores de uso — usado cuando un billable request sale OK. */
  async touchUsage(id: string) {
    await this.prisma.emisor
      .update({
        where: { id },
        data: {
          lastSeenAt: new Date(),
          requestCount: { increment: 1 },
        },
      })
      .catch((e) => {
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError) ||
          e.code !== 'P2025'
        ) {
          this.logger.warn(`No pude actualizar lastSeenAt de emisor ${id}: ${String(e)}`);
        }
      });
  }

  /** Re-ejecuta la validación AFIP para un emisor (por ej. después de renovar cert). */
  async revalidate(organizationId: string, id: string, actorUserId: string) {
    const row = await this.findOneRaw(organizationId, id);
    if (row.deletedAt) {
      throw new BadRequestException('Emisor borrado — no se puede revalidar');
    }

    let certMaterial: { certificate: string; privateKey: string };

    if (row.certMode === EmisorCertMode.PLATFORM) {
      const master = await this.platformCert.getMaterial();
      if (!master) {
        throw new BadRequestException('Cert maestro de plataforma no configurado.');
      }
      certMaterial = { certificate: master.certificate, privateKey: master.privateKey };
    } else {
      if (!row.certificateId) {
        throw new BadRequestException('Emisor sin certificado asociado');
      }
      certMaterial = await this.certificates.resolveMaterial(organizationId, row.certificateId);
    }

    try {
      await this.afip.getPuntosVenta(
        row.cuit,
        certMaterial.certificate,
        certMaterial.privateKey,
        false,
      );
      await this.prisma.emisor.update({
        where: { id },
        data: {
          validationStatus: EmisorValidationStatus.VALIDATED,
          validatedAt: new Date(),
          validationError: null,
          validationErrorCode: null,
        },
      });
      void this.audit.record({
        actorType: AuditActor.USER,
        actorUserId,
        organizationId,
        action: 'emisor.revalidated',
        targetType: 'emisor',
        targetId: id,
      });
      return this.findOne(organizationId, id);
    } catch (err: any) {
      const message = this.extractAfipError(err);
      const code = this.extractAfipErrorCode(err);
      await this.prisma.emisor.update({
        where: { id },
        data: {
          validationStatus: EmisorValidationStatus.FAILED,
          validationError: message,
          validationErrorCode: code,
        },
      });
      throw new UnprocessableEntityException({
        error: 'afip_authorization_failed',
        message: `AFIP rechazó la validación: ${message}`,
      });
    }
  }

  /**
   * Cuenta slots en uso contra plan.cuitLimit. Incluye activos + soft-deleted
   * dentro de la ventana de retención (28d).
   */
  private async countSlotsInUse(organizationId: string): Promise<number> {
    const releaseThreshold = new Date(
      Date.now() - SLOT_RETENTION_DAYS * 86400_000,
    );
    return this.prisma.emisor.count({
      where: {
        organizationId,
        OR: [{ deletedAt: null }, { deletedAt: { gt: releaseThreshold } }],
      },
    });
  }

  /**
   * Consulta el padrón A13 usando las credenciales maestras configuradas en env
   * (MASTER_PADRON_CUIT / MASTER_PADRON_CERT / MASTER_PADRON_KEY).
   * Permite hacer el lookup sin exponer credenciales de clientes.
   */
  async padronLookup(cuit: string) {
    const clean = cuit.replace(/[^\d]/g, '');
    if (!/^\d{11}$/.test(clean)) {
      throw new BadRequestException('CUIT inválido: debe tener 11 dígitos');
    }

    const master = await this.platformCert.getMaterial();
    if (!master) {
      throw new BadRequestException(
        'Consulta al padrón no disponible: cert maestro no configurado. Cargalo en Configuración → Cert maestro.',
      );
    }

    return this.afip.consultarContribuyente({
      cuit: clean,
      cuitEmisor: master.cuit,
      certificado: master.certificate,
      clavePrivada: master.privateKey,
    });
  }

  private extractAfipError(err: any): string {
    if (typeof err?.message === 'string') return err.message;
    if (typeof err?.response?.data === 'string') return err.response.data;
    return String(err);
  }

  private extractAfipErrorCode(err: any): string | null {
    const code = err?.afipCode || err?.code;
    return code ? String(code) : null;
  }

  /**
   * Si el campo empieza con `-----BEGIN` ya es PEM texto; si no, intenta
   * decodificar desde base64 (útil cuando el archivo se sube codificado).
   */
  private decodePemField(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('-----')) return trimmed;
    try {
      return Buffer.from(trimmed, 'base64').toString('utf-8');
    } catch {
      return trimmed;
    }
  }
}
