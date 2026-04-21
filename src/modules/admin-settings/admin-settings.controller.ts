import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminSettingsService } from './admin-settings.service';
import { UpsertSettingDto } from './dto';
import { CurrentUser, RequirePlatformRole, WebOnly } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import type { AuthenticatedUser } from '@/common/types';
import { PlatformRole } from '../../../generated/prisma';

@ApiTags('Admin Settings')
@Controller('admin/settings')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@RequirePlatformRole(PlatformRole.ADMIN, PlatformRole.SUPPORT)
@WebOnly()
export class AdminSettingsController {
  constructor(private readonly service: AdminSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los settings' })
  list() {
    return this.service.list();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Ver un setting por key' })
  get(@Param('key') key: string) {
    return this.service.getOrFail(key);
  }

  @Put(':key')
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({ summary: 'Crear/actualizar un setting (solo ADMIN)' })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
  ) {
    return this.service.set(key, dto.value, user.id, dto.description);
  }
}
