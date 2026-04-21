import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { UpdatePlanDto } from './dto';
import { CurrentUser, Public, RequirePlatformRole } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import type { AuthenticatedUser } from '@/common/types';
import { PlatformRole } from '../../../generated/prisma';

@ApiTags('Plans')
@Controller()
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Listado público de planes disponibles' })
  async listPublic() {
    const items = await this.plansService.listPublic();
    return { items };
  }

  @Get('admin/plans')
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN, PlatformRole.SUPPORT)
  @ApiOperation({ summary: 'Admin: listar todos los planes (incluye ocultos)' })
  async listAll() {
    const items = await this.plansService.listAll();
    return { items };
  }

  @Patch('admin/plans/:id')
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({ summary: 'Admin: editar precio, límites o features de un plan' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.plansService.update(id, dto, user.id);
  }
}
