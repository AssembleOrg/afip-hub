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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { ChangePlanDto } from './dto';
import { CurrentUser, RequirePlatformRole, WebOnly } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import type { AuthenticatedUser } from '@/common/types';
import { PlatformRole } from '../../../generated/prisma';

@ApiTags('Organizations')
@Controller()
@ApiBearerAuth()
@WebOnly()
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @Get('organizations/mine')
  @ApiOperation({ summary: 'Datos de la organización del usuario autenticado' })
  async mine(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Este usuario no pertenece a ninguna organización');
    }
    return this.service.findById(user.organizationId);
  }

  @Get('organizations/mine/members')
  @ApiOperation({ summary: 'Listar miembros de la organización del usuario' })
  async listMembers(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.organizationId) throw new ForbiddenException('Sin organización');
    return this.service.listMembers(user.organizationId);
  }

  @Delete('organizations/mine/members/:userId')
  @ApiOperation({ summary: 'Remover un miembro de la organización (solo OWNER/ADMIN)' })
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') targetUserId: string,
  ) {
    if (!user?.organizationId || (user.orgRole !== 'OWNER' && user.orgRole !== 'ADMIN')) {
      throw new ForbiddenException('Solo OWNER o ADMIN puede remover miembros');
    }
    return this.service.removeMember(user.organizationId, targetUserId, user.id);
  }

  @Patch('organizations/mine/plan')
  @ApiOperation({
    summary: 'Cambiar el plan de la propia organización (solo OWNER)',
  })
  async changeMyPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePlanDto,
  ) {
    if (!user?.organizationId || user.orgRole !== 'OWNER') {
      throw new ForbiddenException('Solo el OWNER puede cambiar el plan');
    }
    return this.service.changePlan(user.organizationId, dto.planSlug, user.id);
  }

  @Get('admin/organizations')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN, PlatformRole.SUPPORT)
  @ApiOperation({ summary: 'Admin: listar todas las organizaciones' })
  listAll(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.service.listAll({
      skip: skip ? Number.parseInt(skip, 10) : undefined,
      take: take ? Number.parseInt(take, 10) : undefined,
    });
  }

  @Post('admin/organizations/:id/suspend')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({ summary: 'Admin: suspender una organización' })
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.service.suspend(id, reason || 'admin', user.id);
  }

  @Post('admin/organizations/:id/reactivate')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({ summary: 'Admin: reactivar una organización suspendida' })
  reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.reactivate(id, user.id);
  }
}
