import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { StorageService } from '@/infra/storage/storage.service';
import {
  CreateInvoiceDto,
  TipoComprobante,
  esNotaCreditoDebito,
} from '@/modules/afip/dto/create-invoice.dto';
import { InvoiceResponseDto } from '@/modules/afip/dto/invoice-response.dto';

export interface InvoicesSearch {
  organizationId: string;
  cuitEmisor?: string;
  from?: Date;
  to?: Date;
  puntoVenta?: number;
  tipoComprobante?: number;
  skip?: number;
  take?: number;
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Persiste una factura recién autorizada por AFIP. Se llama después de un
   * `FECAESolicitar` exitoso (resultado === 'A'). Usa unique sobre
   * (cuitEmisor, puntoVenta, tipoComprobante, numeroComprobante, homologacion)
   * como idempotencia natural: si se re-envía la misma, hacemos upsert.
   */
  async record(params: {
    organizationId: string;
    apiKeyId?: string | null;
    request: CreateInvoiceDto;
    response: InvoiceResponseDto;
    relatedToInvoiceId?: string | null;
  }) {
    const { organizationId, apiKeyId, request, response, relatedToInvoiceId } =
      params;

    const cuitEmisor = (request.cuitEmisor || '').replace(/[^\d]/g, '');
    if (!cuitEmisor) {
      this.logger.warn('Factura sin cuitEmisor — saltando persistencia');
      return null;
    }

    const fechaComprobante = this.parseAfipDate(response.fechaComprobante);
    const caeVencimiento = this.parseAfipDate(response.caeFchVto);
    if (!fechaComprobante || !caeVencimiento || !response.cae) {
      this.logger.warn(
        `Factura sin CAE válido (resultado=${response.resultado}) — saltando persistencia`,
      );
      return null;
    }

    try {
      return await this.prisma.invoice.upsert({
        where: {
          invoice_uniq_emisor_nro: {
            cuitEmisor,
            puntoVenta: response.puntoVenta,
            tipoComprobante: response.tipoComprobante,
            numeroComprobante: BigInt(response.numeroComprobante),
            homologacion: request.homologacion ?? false,
          },
        },
        create: {
          organizationId,
          apiKeyId: apiKeyId ?? null,
          cuitEmisor,
          puntoVenta: response.puntoVenta,
          tipoComprobante: response.tipoComprobante,
          numeroComprobante: BigInt(response.numeroComprobante),
          fechaComprobante,
          cae: response.cae,
          caeVencimiento,
          receptorTipoDoc: request.tipoDocumento ?? null,
          receptorNroDoc: request.cuitCliente ? String(request.cuitCliente) : null,
          condicionIvaReceptor: request.condicionIvaReceptor ?? null,
          moneda: request.monedaId ?? 'PES',
          cotizacion: request.cotizacionMoneda ?? 1,
          importeNeto: request.importeNetoGravado ?? 0,
          importeIva: request.importeIva ?? 0,
          importeTributos: request.importeTributos ?? 0,
          importeTotal: response.importeTotal,
          homologacion: request.homologacion ?? false,
          relatedToInvoiceId: relatedToInvoiceId ?? null,
          rawRequest: this.redactSecrets(request) as any,
          rawResponse: response as any,
        },
        update: {
          cae: response.cae,
          caeVencimiento,
          rawResponse: response as any,
        },
      });
    } catch (err) {
      this.logger.error(`Error persistiendo invoice: ${String(err)}`);
      return null;
    }
  }

  async list(search: InvoicesSearch) {
    const where: any = { organizationId: search.organizationId };
    if (search.cuitEmisor) where.cuitEmisor = search.cuitEmisor.replace(/[^\d]/g, '');
    if (search.puntoVenta) where.puntoVenta = search.puntoVenta;
    if (search.tipoComprobante) where.tipoComprobante = search.tipoComprobante;
    if (search.from || search.to) {
      where.fechaComprobante = {};
      if (search.from) where.fechaComprobante.gte = search.from;
      if (search.to) where.fechaComprobante.lte = search.to;
    }

    const take = Math.min(search.take ?? 50, 200);
    const skip = search.skip ?? 0;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    const page = take > 0 ? Math.floor(skip / take) + 1 : 1;
    return {
      items: items.map((i) => this.serialize(i)),
      total,
      page,
      pageSize: take,
    };
  }

  async findOne(organizationId: string, id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        relatedDocuments: {
          select: {
            id: true,
            tipoComprobante: true,
            puntoVenta: true,
            numeroComprobante: true,
            fechaComprobante: true,
            cae: true,
            importeTotal: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        relatedToInvoice: {
          select: {
            id: true,
            tipoComprobante: true,
            puntoVenta: true,
            numeroComprobante: true,
            fechaComprobante: true,
            cae: true,
            importeTotal: true,
          },
        },
      },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    if (inv.organizationId !== organizationId) {
      throw new ForbiddenException('Factura de otra organización');
    }

    // Transparent rehydrate: si la factura está archivada (rawRequest/Response
    // se movieron a DO Spaces), los traemos al vuelo. El cliente del API no
    // tiene por qué saber que eso ocurrió — la respuesta es idéntica.
    if (inv.archiveKey && (!inv.rawRequest || !inv.rawResponse)) {
      try {
        const archived = await this.storage.getJson<{
          rawRequest: unknown;
          rawResponse: unknown;
        }>(inv.archiveKey);
        if (archived) {
          return this.serialize({
            ...inv,
            rawRequest: archived.rawRequest ?? null,
            rawResponse: archived.rawResponse ?? null,
          });
        }
      } catch (err) {
        this.logger.warn(
          `No pude rehidratar invoice ${id} desde ${inv.archiveKey}: ${String(err)}. Devuelvo sin raw data.`,
        );
      }
    }

    return this.serialize(inv);
  }

  /**
   * Busca una factura por los 5 campos únicos de AFIP (emisor, ptoVta, tipo,
   * nro, homologacion). Usado para resolver `CbteAsoc` → Invoice local cuando
   * se emite una NC/ND desde la API genérica.
   */
  findByAfipRef(params: {
    organizationId: string;
    cuitEmisor: string;
    puntoVenta: number;
    tipoComprobante: number;
    numeroComprobante: number | bigint;
    homologacion: boolean;
  }) {
    return this.prisma.invoice.findUnique({
      where: {
        invoice_uniq_emisor_nro: {
          cuitEmisor: params.cuitEmisor.replace(/[^\d]/g, ''),
          puntoVenta: params.puntoVenta,
          tipoComprobante: params.tipoComprobante,
          numeroComprobante: BigInt(params.numeroComprobante),
          homologacion: params.homologacion,
        },
      },
    });
  }

  /**
   * Arma un `CreateInvoiceDto` para una Nota de Crédito a partir de una
   * factura original. El caller solo provee cert/key + overrides opcionales
   * (motivo/importes parciales). El `CbteAsoc` apunta a la factura original.
   *
   * Mapeo tipoFactura → tipoNC:
   *   Factura A (1)  → NC A (3)
   *   Factura B (6)  → NC B (8)
   *   Factura C (11) → NC C (13)
   *   FCE A (201) → NC FCE A (203), etc.
   */
  async buildCreditNoteDtoFrom(
    organizationId: string,
    originalInvoiceId: string,
    overrides: {
      certificado: string;
      clavePrivada: string;
      importeNetoGravado?: number;
      importeIva?: number;
      importeTributos?: number;
      importeTotal?: number;
      motivo?: string;
      fechaComprobante?: string; // YYYYMMDD
      esAnulacion?: boolean;
    },
  ): Promise<{ dto: CreateInvoiceDto; originalInvoiceId: string }> {
    const original = await this.prisma.invoice.findUnique({
      where: { id: originalInvoiceId },
    });
    if (!original) throw new NotFoundException('Factura original no encontrada');
    if (original.organizationId !== organizationId) {
      throw new ForbiddenException('La factura original es de otra organización');
    }

    const tipoNC = mapTipoFacturaToTipoNC(original.tipoComprobante);
    if (!tipoNC) {
      throw new BadRequestException(
        `El comprobante tipo ${original.tipoComprobante} no admite emitir NC desde este endpoint`,
      );
    }

    const fechaYYYYMMDD = overrides.fechaComprobante ?? formatYYYYMMDD(new Date());

    // Detectar si el tipo original es FCE → la NC también es FCE → reglas especiales
    const esNCFCE = tipoNC >= 201 && tipoNC <= 213;
    // Si es FCE y no se especificó esAnulacion, default a false (NC normal).
    // Si no es FCE, dejamos undefined (el opcional 22 es opcional para NC no FCE).
    const esAnulacion = overrides.esAnulacion ?? (esNCFCE ? false : undefined);

    const dto: CreateInvoiceDto = {
      cuitEmisor: original.cuitEmisor,
      puntoVenta: original.puntoVenta,
      tipoComprobante: tipoNC,
      numeroComprobante: 0 as any, // AFIP lo asigna; WSFE ignora este campo al emitir
      concepto: 1,
      tipoDocumento: original.receptorTipoDoc ?? 99,
      cuitCliente: original.receptorNroDoc ?? '',
      condicionIvaReceptor: original.condicionIvaReceptor ?? undefined,
      fechaComprobante: fechaYYYYMMDD,
      importeNetoGravado:
        overrides.importeNetoGravado ?? Number(original.importeNeto),
      importeNetoNoGravado: 0,
      importeExento: 0,
      importeIva: overrides.importeIva ?? Number(original.importeIva),
      importeTributos: overrides.importeTributos ?? Number(original.importeTributos),
      importeTotal: overrides.importeTotal ?? Number(original.importeTotal),
      monedaId: original.moneda,
      cotizacionMoneda: Number(original.cotizacion),
      certificado: overrides.certificado,
      clavePrivada: overrides.clavePrivada,
      homologacion: original.homologacion,
      esAnulacion,
      comprobantesAsociados: [
        {
          Tipo: original.tipoComprobante,
          PtoVta: original.puntoVenta,
          Nro: Number(original.numeroComprobante),
          CbteFch: formatYYYYMMDD(original.fechaComprobante),
          Cuit: original.cuitEmisor,
        },
      ],
    } as CreateInvoiceDto;

    // Validación básica: la NC no puede exceder el total de la factura original
    if (dto.importeTotal > Number(original.importeTotal)) {
      throw new BadRequestException(
        `Importe total de la NC (${dto.importeTotal}) excede el de la factura original (${original.importeTotal}). AFIP rechazaría esto.`,
      );
    }

    // Regla FCE: CUIT receptor 23000000000 (No Categorizado) prohibido
    if (esNCFCE && dto.cuitCliente === '23000000000') {
      throw new BadRequestException(
        'NC FCE: el receptor CUIT 23000000000 (No Categorizado) no está permitido',
      );
    }

    return { dto, originalInvoiceId: original.id };
  }

  private serialize(inv: any) {
    return {
      ...inv,
      numeroComprobante: inv.numeroComprobante.toString(),
      relatedDocuments: Array.isArray(inv.relatedDocuments)
        ? inv.relatedDocuments.map((d: any) => ({
            ...d,
            numeroComprobante: d.numeroComprobante?.toString(),
          }))
        : undefined,
      relatedToInvoice: inv.relatedToInvoice
        ? {
            ...inv.relatedToInvoice,
            numeroComprobante: inv.relatedToInvoice.numeroComprobante?.toString(),
          }
        : undefined,
    };
  }

  /** YYYYMMDD (AFIP) o ISO → Date (solo la parte date, hora 00:00 UTC) */
  private parseAfipDate(s: string | undefined): Date | null {
    if (!s) return null;
    if (/^\d{8}$/.test(s)) {
      return new Date(
        `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T00:00:00Z`,
      );
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Nunca guardamos certificado/clave en raw_request. */
  private redactSecrets(req: CreateInvoiceDto): Record<string, unknown> {
    const { certificado: _c, clavePrivada: _k, ...rest } = req as any;
    return rest;
  }
}

/** Mapea un tipo de factura a su NC equivalente. Devuelve null si no aplica. */
function mapTipoFacturaToTipoNC(tipoFactura: number): number | null {
  switch (tipoFactura) {
    case TipoComprobante.FACTURA_A:
      return TipoComprobante.NOTA_CREDITO_A;
    case TipoComprobante.FACTURA_B:
      return TipoComprobante.NOTA_CREDITO_B;
    case TipoComprobante.FACTURA_C:
      return TipoComprobante.NOTA_CREDITO_C;
    case TipoComprobante.FACTURA_CREDITO_ELECTRONICA_A:
      return TipoComprobante.NOTA_CREDITO_CREDITO_ELECTRONICA_A;
    case TipoComprobante.FACTURA_CREDITO_ELECTRONICA_B:
      return TipoComprobante.NOTA_CREDITO_CREDITO_ELECTRONICA_B;
    case TipoComprobante.FACTURA_CREDITO_ELECTRONICA_C:
      return TipoComprobante.NOTA_CREDITO_CREDITO_ELECTRONICA_C;
    case TipoComprobante.FACTURA_M:
      return TipoComprobante.NOTA_CREDITO_M;
    default:
      if (esNotaCreditoDebito(tipoFactura)) {
        // Ya es NC/ND — no tiene sentido emitir una NC sobre otra NC
        return null;
      }
      return null;
  }
}

function formatYYYYMMDD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
