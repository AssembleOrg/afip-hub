import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { CurrentUser, RequirePlatformRole, WebOnly } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import type { AuthenticatedUser } from '@/common/types';
import { PlatformRole } from '../../../generated/prisma';
import { AdminOverviewResponseDto, OverviewResponseDto } from './dto';

@ApiTags('Dashboard')
@Controller('dashboard')
@ApiBearerAuth()
@WebOnly()
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Snapshot agregado para la pantalla Overview del tenant',
    description:
      'Un único endpoint que devuelve uso del plan, facturas del ciclo, errores 24h, facturación y últimas 10 facturas. Diseñado para evitar N+1 en el dashboard.',
  })
  @ApiResponse({ status: 200, type: OverviewResponseDto })
  async getOverview(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OverviewResponseDto> {
    if (!user?.organizationId) {
      throw new ForbiddenException('Este usuario no pertenece a ninguna organización');
    }
    return this.service.getOverview(user.organizationId);
  }

  @Get('admin/overview')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN, PlatformRole.SUPPORT)
  @ApiOperation({
    summary: 'Snapshot agregado para la pantalla Admin · Overview (plataforma)',
    description:
      'Orgs activas + nuevas esta semana, MRR en USD/ARS, requests mensuales, distribución por plan, estado de upstreams y uso de disco. En una sola request.',
  })
  @ApiResponse({ status: 200, type: AdminOverviewResponseDto })
  async getAdminOverview(): Promise<AdminOverviewResponseDto> {
    return this.service.getAdminOverview();
  }
}
