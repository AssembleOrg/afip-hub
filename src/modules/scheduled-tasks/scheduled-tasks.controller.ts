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
import { ScheduledTasksService } from './scheduled-tasks.service';
import { CreateScheduledTaskDto, UpdateScheduledTaskDto } from './dto';
import { previewRuns } from './schedule-helper';
import { APP_TIMEZONE } from '@/common/utils/clock';
import { CurrentUser } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types';

@ApiTags('Scheduled Tasks')
@Controller({ path: 'scheduled-tasks', version: '1' })
@ApiBearerAuth()
export class ScheduledTasksController {
  constructor(private readonly service: ScheduledTasksService) {}

  @Post()
  @ApiOperation({ summary: 'Crear tarea programada (usa cert persistido cifrado)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateScheduledTaskDto) {
    this.assertOwnerOrAdmin(user);
    return this.service.create({
      organizationId: user.organizationId!,
      createdByUserId: user.id,
      dto,
    });
  }

  @Post('preview')
  @ApiOperation({
    summary: 'Preview: dada una cronExpression + timezone, devuelve las próximas 5 ejecuciones',
    description: 'Usalo en el frontend mientras el user arma el schedule.',
  })
  preview(
    @Body() body: { cronExpression: string; timezone?: string; count?: number },
  ) {
    const tz = body.timezone || APP_TIMEZONE;
    const n = Math.min(body.count ?? 5, 20);
    return previewRuns(body.cronExpression, tz, n);
  }

  @Get()
  @ApiOperation({ summary: 'Listar tareas programadas de la org' })
  list(@CurrentUser() user: AuthenticatedUser) {
    this.assertOrgMember(user);
    return this.service.list(user.organizationId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle + últimas 20 corridas' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOrgMember(user);
    return this.service.get(user.organizationId!, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar tarea (recomputa nextRunAt si cambia el schedule)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateScheduledTaskDto,
  ) {
    this.assertOwnerOrAdmin(user);
    return this.service.update(user.organizationId!, id, dto, user.id);
  }

  @Post(':id/toggle')
  @ApiOperation({ summary: 'Activar/desactivar' })
  toggle(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOwnerOrAdmin(user);
    return this.service.toggle(user.organizationId!, id, user.id);
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
      throw new ForbiddenException('Solo OWNER/ADMIN puede gestionar tareas programadas');
    }
  }
}
