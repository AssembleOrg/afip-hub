import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { VerifyInvoiceDto } from './dto/verify-invoice.dto';
import { AfipService } from '@/modules/afip/afip.service';
import { Billable, CurrentUser, Idempotent } from '@/common/decorators';
import type { AuthenticatedUser, SaasRequest } from '@/common/types';
import { PrismaService } from '@/database/prisma.service';

@ApiTags('Invoices')
@Controller({ path: 'invoices', version: '1' })
@ApiBearerAuth()
export class InvoicesController {
  constructor(
    private readonly service: InvoicesService,
    private readonly afip: AfipService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar facturas emitidas por la organización',
    description:
      'Filtros opcionales por CUIT emisor, punto de venta, tipo y rango de fechas. Paginado.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListInvoicesQueryDto,
  ) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }
    const pageSize = query.pageSize ?? query.take ?? 20;
    const skip =
      query.skip !== undefined
        ? query.skip
        : query.page !== undefined
          ? (query.page - 1) * pageSize
          : 0;
    return this.service.list({
      organizationId: user.organizationId,
      cuitEmisor: query.cuitEmisor,
      puntoVenta: query.puntoVenta,
      tipoComprobante: query.tipoComprobante,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      skip,
      take: pageSize,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de una factura (incluye NC/ND asociadas)',
  })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }
    return this.service.findOne(user.organizationId, id);
  }

  @Post(':id/credit-note')
  @Billable()
  @Idempotent()
  @ApiOperation({
    summary: 'Emitir una Nota de Crédito contra esta factura',
    description:
      'Arma el DTO automáticamente desde la factura original: mismo emisor/receptor, mismos importes por default, CbteAsoc apuntando correcto. Solo mandás cert+key. Si querés NC parcial, pasá `importeTotal`/`importeNeto` custom (no puede exceder el original). Persiste la NC con relación a la factura original.',
  })
  async createCreditNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateCreditNoteDto,
    @Req() req: SaasRequest,
  ) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }

    const { dto: invoiceDto, originalInvoiceId } =
      await this.service.buildCreditNoteDtoFrom(user.organizationId, id, {
        certificado: dto.certificado,
        clavePrivada: dto.clavePrivada,
        importeNetoGravado: dto.importeNetoGravado,
        importeIva: dto.importeIva,
        importeTributos: dto.importeTributos,
        importeTotal: dto.importeTotal,
        fechaComprobante: dto.fechaComprobante,
        esAnulacion: dto.esAnulacion,
      });

    const response = await this.afip.createInvoice(invoiceDto);

    if (response.resultado === 'A' && response.cae) {
      await this.service.record({
        organizationId: user.organizationId,
        apiKeyId: req.apiKey?.id ?? null,
        request: invoiceDto,
        response,
        relatedToInvoiceId: originalInvoiceId,
      });
    }

    return {
      ...response,
      relatedToInvoiceId: originalInvoiceId,
      motivo: dto.motivo ?? null,
    };
  }

  @Post(':id/verify')
  @Billable()
  @ApiOperation({
    summary: 'Verificar una factura propia contra AFIP (constatación WSCDC)',
    description:
      'Carga los datos de la factura desde DB y llama al WSCDC con todos los campos completos (CAE, importe, fecha, receptor). Solo pedís cert+key. Útil para auditoría: confirma que la factura sigue registrada y válida en AFIP.',
  })
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: VerifyInvoiceDto,
  ) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }

    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    if (inv.organizationId !== user.organizationId) {
      throw new ForbiddenException('Factura de otra organización');
    }
    if (!inv.cae) {
      throw new BadRequestException(
        'La factura no tiene CAE — nada para verificar',
      );
    }

    const result = await this.afip.constatarComprobanteCompleto({
      cuitAutenticador: inv.cuitEmisor,
      certificado: dto.certificado,
      clavePrivada: dto.clavePrivada,
      cbteModo: dto.cbteModo ?? 'CAE',
      cuitEmisorComprobante: inv.cuitEmisor,
      puntoVenta: inv.puntoVenta,
      tipoComprobante: inv.tipoComprobante,
      numeroComprobante: Number(inv.numeroComprobante),
      fechaComprobante: formatYYYYMMDD(inv.fechaComprobante),
      importeTotal: Number(inv.importeTotal),
      codAutorizacion: inv.cae,
      docTipoReceptor: inv.receptorTipoDoc?.toString(),
      docNroReceptor: inv.receptorNroDoc ?? undefined,
      homologacion: inv.homologacion,
    });

    return {
      invoiceId: inv.id,
      verified: result.resultado,
      ...result,
    };
  }
}

function formatYYYYMMDD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
