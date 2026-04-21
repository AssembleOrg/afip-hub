import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SelfBillingService } from './self-billing.service';
import { PrismaService } from '@/database/prisma.service';
import { RequirePlatformRole, WebOnly } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import {
  PlatformInvoiceStatus,
  PlatformRole,
} from '../../../generated/prisma';

@ApiTags('Self-billing (admin)')
@Controller('admin/platform-invoices')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@RequirePlatformRole(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@WebOnly()
export class SelfBillingController {
  constructor(
    private readonly service: SelfBillingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Admin: listar facturas que emitimos a subscribers' })
  @ApiQuery({ name: 'status', required: false, enum: Object.values(PlatformInvoiceStatus) })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async list(
    @Query('status') status?: PlatformInvoiceStatus,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const where: any = {};
    if (status) where.status = status;
    const items = await this.prisma.platformInvoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: skip ? Number.parseInt(skip, 10) : 0,
      take: Math.min(take ? Number.parseInt(take, 10) : 50, 200),
      include: {
        payment: {
          select: {
            id: true,
            mpPaymentId: true,
            amountArs: true,
            paidAt: true,
            subscription: {
              select: { organizationId: true, planId: true },
            },
          },
        },
      },
    });
    return {
      items: items.map((p) => ({
        ...p,
        numeroComprobante: p.numeroComprobante?.toString() ?? null,
      })),
    };
  }

  @Post(':id/retry')
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: reintentar manualmente una PlatformInvoice FAILED/ABANDONED',
    description:
      'Resetea el contador de intentos si estaba ABANDONED y reintenta la emisión en AFIP.',
  })
  async retry(@Param('id') id: string) {
    // Si estaba ABANDONED, bajamos a FAILED para que el service la considere de nuevo.
    await this.prisma.platformInvoice.updateMany({
      where: { id, status: PlatformInvoiceStatus.ABANDONED },
      data: { status: PlatformInvoiceStatus.FAILED, attempts: 0 },
    });
    await this.service.retry(id);
    return this.prisma.platformInvoice.findUnique({ where: { id } }).then((r) => ({
      ...r,
      numeroComprobante: r?.numeroComprobante?.toString() ?? null,
    }));
  }

  @Post('retry-all')
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: procesar todas las FAILED/PENDING (sin tocar ABANDONED)',
  })
  async retryAll(@Body() body: { limit?: number }) {
    return this.service.processRetries(body.limit ?? 50);
  }
}
