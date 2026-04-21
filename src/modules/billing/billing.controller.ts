import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { MercadoPagoService } from './mercadopago.service';
import { SubscribeDto } from './dto';
import { CurrentUser, Public, WebOnly } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types';
import { PrismaService } from '@/database/prisma.service';
import { AddOnSubscriptionsService } from '@/modules/addons/addon-subscriptions.service';

@ApiTags('Billing')
@Controller()
@WebOnly()
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly mp: MercadoPagoService,
    private readonly addonSubs: AddOnSubscriptionsService,
  ) {}

  @Post('billing/subscribe')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear suscripción con MercadoPago para el plan elegido',
    description:
      'Devuelve `initPoint` para redirigir al usuario a MP a autorizar el cobro recurrente.',
  })
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribeDto,
  ) {
    if (!user?.organizationId || user.orgRole !== 'OWNER') {
      throw new ForbiddenException('Solo el OWNER puede suscribir la organización');
    }
    return this.subscriptions.subscribe({
      organizationId: user.organizationId,
      payerEmail: user.email,
      planSlug: dto.planSlug,
      backUrl: dto.backUrl,
      actorUserId: user.id,
    });
  }

  @Get('billing/subscription')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resumen de facturación de la org (BillingSummary)' })
  async getSubscription(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }
    return this.subscriptions.getSummary(user.organizationId);
  }

  @Post('billing/subscription/cancel')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancelar la suscripción (vuelve al plan free)' })
  async cancel(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.organizationId || user.orgRole !== 'OWNER') {
      throw new ForbiddenException('Solo el OWNER puede cancelar la suscripción');
    }
    await this.subscriptions.cancel(user.organizationId, user.id);
    return { ok: true };
  }

  @Post('billing/subscription/refresh')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Forzar un sync del estado contra MP (útil tras volver del back_url)',
  })
  async refresh(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.organizationId) throw new ForbiddenException('Sin organización');
    const org = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
    });
    if (!org?.mpPreapprovalId) {
      throw new BadRequestException('La organización no tiene preapproval en MP');
    }
    return this.subscriptions.refreshFromMp(org.mpPreapprovalId);
  }

  /**
   * Webhook de MercadoPago. MP envía notificaciones de `preapproval` (cambios
   * de estado) y `payment` (cobros). Validamos firma HMAC si hay secreto.
   *
   * Respondemos 200 rápido siempre: MP reintenta si recibe !=200, así que
   * cualquier error interno se loguea pero no se propaga.
   */
  @Public()
  @Post('webhooks/mercadopago')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook público de MercadoPago' })
  async webhook(
    @Body() body: any,
    @Query() query: any,
    @Headers('x-signature') signature?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    try {
      const topic = body?.type ?? body?.topic ?? query?.type ?? query?.topic;
      const resourceId = String(
        body?.data?.id ?? body?.resource ?? query?.['data.id'] ?? query?.id ?? '',
      );
      if (!topic || !resourceId) {
        this.logger.warn(`Webhook MP sin topic/id: ${JSON.stringify({ body, query })}`);
        return { ok: true };
      }

      const sigOk = this.mp.verifyWebhookSignature({
        resourceId,
        requestId,
        xSignature: signature,
      });
      if (!sigOk) {
        this.logger.error(`Webhook MP con firma inválida (topic=${topic} id=${resourceId})`);
        throw new UnauthorizedException('Firma inválida');
      }

      if (topic === 'preapproval' || topic === 'subscription_preapproval') {
        const data = await this.mp.getPreapproval(resourceId);
        // Addons primero: si el preapproval corresponde a un addon, short-circuit.
        const handledAsAddon = await this.addonSubs.applyPreapprovalUpdate(data);
        if (!handledAsAddon) {
          await this.subscriptions.applyPreapprovalUpdate(data);
        }
      } else if (topic === 'payment') {
        const data = await this.mp.getPayment(resourceId);
        const handledAsAddon = await this.addonSubs.applyPaymentUpdate(data);
        if (!handledAsAddon) {
          await this.subscriptions.applyPaymentUpdate(data);
        }
      } else {
        this.logger.debug(`Webhook MP topic=${topic} ignorado`);
      }
    } catch (err) {
      // Respondemos 200 para que MP no reintente en errores no recuperables.
      // Los recuperables (network hacia MP) se manejarán reproductivamente.
      this.logger.error(`Error procesando webhook MP: ${String(err)}`);
    }
    return { ok: true };
  }
}
