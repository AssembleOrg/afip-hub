import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditService, AuditSearchFilters } from './audit.service';
import { CurrentUser, RequirePlatformRole, WebOnly } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import type { AuthenticatedUser } from '@/common/types';
import {
  AuditActor,
  PlatformRole,
} from '../../../generated/prisma';

@ApiTags('Audit')
@Controller()
@ApiBearerAuth()
@WebOnly()
export class AuditController {
  constructor(private readonly service: AuditService) {}

  // ==========================================================
  //  Endpoints para el OWNER/ADMIN de la org (solo su propia auditoría)
  // ==========================================================

  @Get('organizations/mine/audit')
  @ApiOperation({
    summary: 'Auditoría de la propia organización',
    description:
      'Scoped por JWT: solo devuelve eventos donde `organizationId` es igual al del usuario.',
  })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'actionPrefix', required: false, example: 'auth.' })
  @ApiQuery({ name: 'result', required: false, enum: ['ok', 'fail'] })
  @ApiQuery({ name: 'actorUserId', required: false })
  @ApiQuery({ name: 'actorApiKeyId', required: false })
  @ApiQuery({ name: 'targetType', required: false })
  @ApiQuery({ name: 'targetId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() q: Record<string, string>,
  ) {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }
    if (user.orgRole !== 'OWNER' && user.orgRole !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo OWNER/ADMIN de la organización puede ver la auditoría',
      );
    }

    // Orden importa: parseFilters primero, orgId del JWT sobrescribe al final
    // para que el scope NO pueda ser violado por query params.
    const filters: AuditSearchFilters = {
      ...this.parseFilters(q),
      organizationId: user.organizationId, // scope lock
    };
    return this.service.search(filters);
  }

  @Get('organizations/mine/audit/actions')
  @ApiOperation({ summary: 'Lista de acciones disponibles para filtrar (UI)' })
  async mineActions(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.organizationId) throw new ForbiddenException('Sin organización');
    const items = await this.service.listActions(user.organizationId);
    return { items };
  }

  // ==========================================================
  //  Endpoints para platform admin (cualquier org)
  // ==========================================================

  @Get('admin/audit')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN, PlatformRole.SUPPORT)
  @ApiOperation({
    summary: 'Admin: auditoría global (todas las orgs)',
    description: 'Permite filtrar por `organizationId` explícito para scopear.',
  })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'actorType', required: false, enum: Object.values(AuditActor) })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'actionPrefix', required: false })
  @ApiQuery({ name: 'result', required: false, enum: ['ok', 'fail'] })
  @ApiQuery({ name: 'severity', required: false, enum: ['info', 'warn', 'error'] })
  @ApiQuery({ name: 'actorUserId', required: false })
  @ApiQuery({ name: 'targetType', required: false })
  @ApiQuery({ name: 'targetId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  async admin(@Query() q: Record<string, string>) {
    return this.service.search(this.parseFilters(q));
  }

  @Get('admin/audit/actions')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN, PlatformRole.SUPPORT)
  @ApiOperation({ summary: 'Admin: lista de acciones distintas vistas en toda la plataforma' })
  async adminActions() {
    return this.service.listActions();
  }

  // ==========================================================

  private parseFilters(q: Record<string, string>): AuditSearchFilters {
    return {
      organizationId: q.organizationId,
      actorUserId: q.actorUserId,
      actorApiKeyId: q.actorApiKeyId,
      actorType: (q.actorType as AuditActor) || undefined,
      action: q.action,
      actionPrefix: q.actionPrefix,
      targetType: q.targetType,
      targetId: q.targetId,
      result: (q.result as 'ok' | 'fail') || undefined,
      severity: (q.severity as 'info' | 'warn' | 'error') || undefined,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      q: q.q,
      skip: q.skip ? Number.parseInt(q.skip, 10) : 0,
      take: q.take ? Number.parseInt(q.take, 10) : 50,
    };
  }
}
