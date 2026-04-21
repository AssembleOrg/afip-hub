import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@/database/prisma.service';
import { CertificatesService } from '@/modules/certificates/certificates.service';
import { AfipService } from '@/modules/afip/afip.service';
import {
  EmisorValidationStatus,
  Prisma,
} from '../../../generated/prisma';
import {
  EVENTS,
  VentanillaNewMessagePayload,
} from '@/common/events';

export interface FetchResult {
  emisorId: string;
  fetched: number;
  persisted: number;
  error?: string;
}

@Injectable()
export class VentanillaService {
  private readonly logger = new Logger(VentanillaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certificates: CertificatesService,
    private readonly afip: AfipService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Recorre todos los emisores validados de la plataforma y para cada uno
   * consulta AFIP. Dedupe por `(emisorId, afipMessageId)`. Llamado por cron.
   */
  async fetchAllPending(): Promise<{
    scanned: number;
    totalNew: number;
    results: FetchResult[];
  }> {
    const emisores = await this.prisma.emisor.findMany({
      where: {
        deletedAt: null,
        validationStatus: EmisorValidationStatus.VALIDATED,
        certificateId: { not: null },
      },
      select: {
        id: true,
        organizationId: true,
        cuit: true,
        alias: true,
        certificateId: true,
        organization: { select: { owner: { select: { email: true } } } },
      },
    });

    const results: FetchResult[] = [];
    let totalNew = 0;

    for (const emisor of emisores) {
      const r = await this.fetchForEmisor({
        emisorId: emisor.id,
        organizationId: emisor.organizationId,
        cuit: emisor.cuit,
        alias: emisor.alias,
        certificateId: emisor.certificateId!,
        ownerEmail: emisor.organization?.owner?.email ?? '',
      }).catch((err) => ({
        emisorId: emisor.id,
        fetched: 0,
        persisted: 0,
        error: String(err?.message ?? err),
      }));
      results.push(r);
      totalNew += r.persisted;
      // Espaciamos para no saturar AFIP.
      await this.sleep(150);
    }

    return { scanned: emisores.length, totalNew, results };
  }

  /**
   * Consulta AFIP Ventanilla para un emisor específico y persiste los mensajes
   * nuevos. Usado por el cron y también disponible como endpoint manual.
   */
  async fetchForEmisor(params: {
    emisorId: string;
    organizationId: string;
    cuit: string;
    alias: string | null;
    certificateId: string;
    ownerEmail: string;
  }): Promise<FetchResult> {
    const material = await this.certificates.resolveMaterial(
      params.organizationId,
      params.certificateId,
    );

    // Pedimos solo las "no leídas" desde AFIP (estado=1) paginadas.
    const PAGE_SIZE = 50;
    let page = 1;
    let total = 0;
    const newMessages: Array<{
      afipMessageId: bigint;
      asunto: string;
      fechaPublicacion: Date;
      fechaVencimiento: Date | null;
      sistemaPublicador: number | null;
      sistemaPublicadorDesc: string | null;
      prioridad: number | null;
      tieneAdjunto: boolean;
      estadoAfip: number;
    }> = [];

    while (true) {
      const resp = await this.afip.consultarComunicaciones(
        params.cuit,
        material.certificate,
        material.privateKey,
        { estado: 1 },
        page,
        PAGE_SIZE,
        false,
      );

      for (const c of resp.comunicaciones) {
        newMessages.push({
          afipMessageId: BigInt(c.idComunicacion),
          asunto: c.asunto,
          fechaPublicacion: this.parseAfipDate(c.fechaPublicacion),
          fechaVencimiento: c.fechaVencimiento
            ? this.parseAfipDate(c.fechaVencimiento)
            : null,
          sistemaPublicador: c.sistemaPublicador ?? null,
          sistemaPublicadorDesc: c.sistemaPublicadorDesc ?? null,
          prioridad: c.prioridad ?? null,
          tieneAdjunto: c.tieneAdjunto,
          estadoAfip: c.estado,
        });
      }
      total += resp.comunicaciones.length;

      const { pagina, totalPaginas } = resp.paginacion;
      if (pagina >= totalPaginas || resp.comunicaciones.length === 0) break;
      page = pagina + 1;
      if (page > 20) break; // safety: max 1000 mensajes por emisor por tick
    }

    let persisted = 0;
    for (const msg of newMessages) {
      try {
        await this.prisma.afipVentanillaMessage.create({
          data: {
            organizationId: params.organizationId,
            emisorId: params.emisorId,
            afipMessageId: msg.afipMessageId,
            asunto: msg.asunto,
            fechaPublicacion: msg.fechaPublicacion,
            fechaVencimiento: msg.fechaVencimiento,
            sistemaPublicador: msg.sistemaPublicador,
            sistemaPublicadorDesc: msg.sistemaPublicadorDesc,
            prioridad: msg.prioridad,
            tieneAdjunto: msg.tieneAdjunto,
            estadoAfip: msg.estadoAfip,
            raw: msg as any,
          },
        });
        persisted++;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // dedupe — ya existía
          continue;
        }
        this.logger.warn(
          `No pude persistir mensaje ${msg.afipMessageId} emisor=${params.emisorId}: ${String(err)}`,
        );
      }
    }

    if (persisted > 0 && params.ownerEmail) {
      // Emitimos un solo evento agregado para no spamear cuando hay muchos.
      const lastMsg = newMessages[0];
      const created = await this.prisma.afipVentanillaMessage.findFirst({
        where: { emisorId: params.emisorId, afipMessageId: lastMsg.afipMessageId },
      });
      if (created) {
        const payload: VentanillaNewMessagePayload = {
          organizationId: params.organizationId,
          emisorId: params.emisorId,
          emisorCuit: params.cuit,
          emisorAlias: params.alias,
          messageId: created.id,
          afipMessageId: lastMsg.afipMessageId.toString(),
          asunto: lastMsg.asunto,
          sistemaPublicadorDesc: lastMsg.sistemaPublicadorDesc,
          fechaPublicacion: lastMsg.fechaPublicacion,
          fechaVencimiento: lastMsg.fechaVencimiento,
          ownerEmail: params.ownerEmail,
          newCount: persisted,
        };
        this.events.emit(EVENTS.VENTANILLA_NEW_MESSAGE, payload);
      }
    }

    return { emisorId: params.emisorId, fetched: total, persisted };
  }

  // ── Endpoints API ────────────────────────────────────────────────────────

  list(
    organizationId: string,
    opts: {
      emisorId?: string;
      unreadOnly?: boolean;
      skip?: number;
      take?: number;
    },
  ) {
    const where: Prisma.AfipVentanillaMessageWhereInput = { organizationId };
    if (opts.emisorId) where.emisorId = opts.emisorId;
    if (opts.unreadOnly) where.readAt = null;

    const skip = opts.skip ?? 0;
    const take = Math.min(opts.take ?? 20, 100);

    return this.prisma
      .$transaction([
        this.prisma.afipVentanillaMessage.findMany({
          where,
          orderBy: { fechaPublicacion: 'desc' },
          skip,
          take,
          include: {
            emisor: { select: { id: true, cuit: true, alias: true, razonSocial: true } },
          },
        }),
        this.prisma.afipVentanillaMessage.count({ where }),
      ])
      .then(([items, total]) => ({
        data: items.map((i) => ({
          ...i,
          afipMessageId: i.afipMessageId.toString(),
        })),
        meta: { total, skip, take },
      }));
  }

  async findOne(organizationId: string, id: string) {
    const row = await this.prisma.afipVentanillaMessage.findUnique({
      where: { id },
      include: {
        emisor: { select: { id: true, cuit: true, alias: true, razonSocial: true, certificateId: true } },
      },
    });
    if (!row) throw new NotFoundException('Mensaje no encontrado');
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException('El mensaje pertenece a otra organización');
    }
    return { ...row, afipMessageId: row.afipMessageId.toString() };
  }

  /**
   * Trae el body del mensaje desde AFIP (con adjuntos opcionales) y lo cachea.
   * Marca automáticamente como leído en AFIP y localmente.
   */
  async openMessage(
    organizationId: string,
    id: string,
    userId: string,
    includeAttachments = false,
  ) {
    const msg = await this.prisma.afipVentanillaMessage.findUnique({
      where: { id },
      include: { emisor: true },
    });
    if (!msg) throw new NotFoundException('Mensaje no encontrado');
    if (msg.organizationId !== organizationId) {
      throw new ForbiddenException('El mensaje pertenece a otra organización');
    }

    // Si ya cacheamos el body antes y no piden adjuntos, devolvemos del cache.
    if (msg.body && msg.bodyFetchedAt && !includeAttachments) {
      if (!msg.readAt) {
        await this.prisma.afipVentanillaMessage.update({
          where: { id },
          data: { readAt: new Date(), readByUserId: userId },
        });
      }
      return { ...msg, afipMessageId: msg.afipMessageId.toString() };
    }

    if (!msg.emisor.certificateId) {
      throw new ForbiddenException(
        'Emisor sin certificado asociado — no puedo traer el body desde AFIP',
      );
    }
    const material = await this.certificates.resolveMaterial(
      organizationId,
      msg.emisor.certificateId,
    );

    const detalle = await this.afip.consumirComunicacion(
      msg.emisor.cuit,
      material.certificate,
      material.privateKey,
      Number(msg.afipMessageId),
      includeAttachments,
      false,
    );

    const updated = await this.prisma.afipVentanillaMessage.update({
      where: { id },
      data: {
        body: detalle.cuerpo ?? null,
        bodyFetchedAt: new Date(),
        readAt: msg.readAt ?? new Date(),
        readByUserId: msg.readAt ? msg.readByUserId : userId,
        estadoAfip: 2,
      },
    });

    return {
      ...updated,
      afipMessageId: updated.afipMessageId.toString(),
      adjuntos: detalle.adjuntos ?? [],
    };
  }

  async markRead(organizationId: string, id: string, userId: string) {
    const msg = await this.prisma.afipVentanillaMessage.findUnique({
      where: { id },
    });
    if (!msg) throw new NotFoundException('Mensaje no encontrado');
    if (msg.organizationId !== organizationId) {
      throw new ForbiddenException('El mensaje pertenece a otra organización');
    }
    if (msg.readAt) return msg;
    return this.prisma.afipVentanillaMessage.update({
      where: { id },
      data: { readAt: new Date(), readByUserId: userId },
    });
  }

  private parseAfipDate(s: string): Date {
    // AFIP VE puede mandar YYYY-MM-DD o YYYYMMDD
    if (/^\d{8}$/.test(s)) {
      return new Date(
        `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`,
      );
    }
    return new Date(s);
  }

  private sleep(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }
}
