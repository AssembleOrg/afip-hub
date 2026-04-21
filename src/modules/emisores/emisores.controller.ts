import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmisoresService } from './emisores.service';
import { CreateEmisorDto, ListEmisoresDto, UpdateEmisorDto } from './dto';
import { CurrentUser, CurrentOrg } from '@/common/decorators';
import type { AuthenticatedUser, ResolvedOrganization } from '@/common/types';

@ApiTags('Emisores')
@Controller({ path: 'emisores', version: '1' })
@ApiBearerAuth()
export class EmisoresController {
  constructor(private readonly service: EmisoresService) {}

  @Post()
  @ApiOperation({
    summary: 'Registrar un emisor (valida permisos contra AFIP)',
    description:
      'Consume un slot de plan.cuitLimit. El soft-delete mantiene ocupado el slot 28 días para prevenir abuso create/delete.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrg() org: ResolvedOrganization | undefined,
    @Body() dto: CreateEmisorDto,
  ) {
    this.assertOrgAdmin(user);
    if (!org) throw new ForbiddenException('Sin organización resuelta');
    return this.service.create({
      organizationId: org.id,
      createdByUserId: user.id,
      dto,
      cuitLimit: org.cuitLimit,
      planSlug: org.planSlug,
    });
  }

  @Get('padron/:cuit')
  @ApiOperation({
    summary: 'Consultar contribuyente en padrón A13 (credenciales maestras)',
    description: 'Lookup en padrón A13 usando el CUIT maestro configurado en el servidor. No requiere certificado del cliente.',
  })
  async padronLookup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cuit') cuit: string,
  ) {
    if (!user.id) throw new UnauthorizedException();
    return this.service.padronLookup(cuit);
  }

  @Get()
  @ApiOperation({ summary: 'Listar emisores de la org (paginado)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListEmisoresDto) {
    this.assertOrg(user);
    return this.service.list(user.organizationId!, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un emisor' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOrg(user);
    return this.service.findOne(user.organizationId!, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar alias / razón social' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmisorDto,
  ) {
    this.assertOrgAdmin(user);
    return this.service.update(user.organizationId!, id, dto, user.id);
  }

  @Post(':id/revalidate')
  @ApiOperation({ summary: 'Re-ejecutar validación AFIP (ej. tras renovar cert)' })
  revalidate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOrgAdmin(user);
    return this.service.revalidate(user.organizationId!, id, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete (slot sigue ocupado 28 días)',
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOrgAdmin(user);
    return this.service.remove(user.organizationId!, id, user.id);
  }

  private assertOrg(user: AuthenticatedUser) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }
  }

  private assertOrgAdmin(user: AuthenticatedUser) {
    this.assertOrg(user);
    if (user.orgRole !== 'OWNER' && user.orgRole !== 'ADMIN') {
      throw new ForbiddenException('Solo OWNER/ADMIN puede gestionar emisores');
    }
  }
}
