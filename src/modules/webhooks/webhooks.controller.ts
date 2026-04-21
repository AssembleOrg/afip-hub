import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';
import { CurrentUser } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types';
import { ALL_EVENT_TYPES } from '@/common/events';

@ApiTags('Webhooks (outbound)')
@Controller({ path: 'webhook-subscriptions', version: '1' })
@ApiBearerAuth()
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Get('event-types')
  @ApiOperation({
    summary: 'Lista de event types disponibles para suscribirse',
  })
  eventTypes() {
    return { items: [...ALL_EVENT_TYPES] };
  }

  @Post()
  @ApiOperation({
    summary: 'Crear suscripción de webhook (devuelve el secret UNA vez)',
    description:
      'El secret se usa para validar la firma `X-Webhook-Signature: sha256=<hex>` de cada delivery. Guardalo bien — solo se muestra acá.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWebhookDto) {
    this.assertOwnerOrAdmin(user);
    return this.service.create({
      organizationId: user.organizationId!,
      createdByUserId: user.id,
      dto,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Listar webhooks de la organización' })
  list(@CurrentUser() user: AuthenticatedUser) {
    this.assertOrgMember(user);
    return this.service.list(user.organizationId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle + últimas 20 entregas' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOrgMember(user);
    return this.service.get(user.organizationId!, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar URL, events, description o estado' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    this.assertOwnerOrAdmin(user);
    return this.service.update(user.organizationId!, id, dto, user.id);
  }

  @Post(':id/rotate-secret')
  @ApiOperation({
    summary: 'Rotar el secret de firma (invalida el secret previo)',
  })
  rotate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOwnerOrAdmin(user);
    return this.service.rotateSecret(user.organizationId!, id, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar (soft delete)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOwnerOrAdmin(user);
    return this.service.remove(user.organizationId!, id, user.id);
  }

  private assertOrgMember(user: AuthenticatedUser | undefined): void {
    if (!user?.organizationId) throw new ForbiddenException('Sin organización');
  }

  private assertOwnerOrAdmin(user: AuthenticatedUser | undefined): void {
    this.assertOrgMember(user);
    if (user!.orgRole !== 'OWNER' && user!.orgRole !== 'ADMIN') {
      throw new ForbiddenException('Solo OWNER/ADMIN puede gestionar webhooks');
    }
  }
}
