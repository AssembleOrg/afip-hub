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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AddOnsService } from './addons.service';
import { AddOnSubscriptionsService } from './addon-subscriptions.service';
import { CreateAddOnDto, SubscribeAddOnDto, UpdateAddOnDto } from './dto';
import { CurrentUser, Public, RequirePlatformRole, WebOnly } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types';
import { PlatformRole } from '../../../generated/prisma';

@ApiTags('AddOns')
@Controller()
@WebOnly()
export class AddOnsController {
  constructor(
    private readonly addons: AddOnsService,
    private readonly subs: AddOnSubscriptionsService,
  ) {}

  // ── Catálogo público ────────────────────────────────────────────────────

  @Public()
  @Get('addons')
  @ApiOperation({ summary: 'Listado público del catálogo de addons contratables' })
  async listPublic() {
    const items = await this.addons.listPublic();
    return { items };
  }

  @Get('addons/:slug')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalle de un addon del catálogo' })
  getBySlug(@Param('slug') slug: string) {
    return this.addons.getBySlug(slug);
  }

  // ── Suscripciones del usuario ───────────────────────────────────────────

  @Get('addons/mine/list')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar addons contratados por la org' })
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }
    const items = await this.subs.listForOrg(user.organizationId);
    return { items };
  }

  @Post('addons/subscribe')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Contratar un addon (crea preapproval MP)' })
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribeAddOnDto,
  ) {
    if (!user?.organizationId || user.orgRole !== 'OWNER') {
      throw new ForbiddenException('Solo el OWNER puede contratar addons');
    }
    return this.subs.subscribe({
      organizationId: user.organizationId,
      payerEmail: user.email,
      dto,
      actorUserId: user.id,
    });
  }

  @Post('addons/:slug/cancel')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancelar la suscripción a un addon' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
  ) {
    if (!user?.organizationId || user.orgRole !== 'OWNER') {
      throw new ForbiddenException('Solo el OWNER puede cancelar addons');
    }
    await this.subs.cancel(user.organizationId, slug, user.id);
    return { ok: true };
  }

  // ── Admin: CRUD del catálogo ────────────────────────────────────────────

  @Get('admin/addons')
  @ApiBearerAuth()
  @RequirePlatformRole(PlatformRole.ADMIN, PlatformRole.SUPPORT)
  @ApiOperation({ summary: '[Admin] Listar TODOS los addons (activos + inactivos)' })
  listAll() {
    return this.addons.listAll();
  }

  @Post('admin/addons')
  @ApiBearerAuth()
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Crear nuevo addon' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAddOnDto,
  ) {
    return this.addons.create(dto, user.id);
  }

  @Patch('admin/addons/:id')
  @ApiBearerAuth()
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Actualizar addon existente' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAddOnDto,
  ) {
    return this.addons.update(id, dto, user.id);
  }

  @Delete('admin/addons/:id')
  @ApiBearerAuth()
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({
    summary: '[Admin] Eliminar addon (falla si hay suscripciones activas)',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.addons.remove(id, user.id);
    return { ok: true };
  }
}
