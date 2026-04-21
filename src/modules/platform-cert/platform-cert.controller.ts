import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformCertService } from './platform-cert.service';
import { SetPlatformCertDto } from './dto/set-platform-cert.dto';
import { RequirePlatformRole, WebOnly } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import { PlatformRole } from '../../../generated/prisma';

@ApiTags('Admin – Platform Cert')
@Controller('admin/platform-cert')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@RequirePlatformRole(PlatformRole.ADMIN)
@WebOnly()
export class PlatformCertController {
  constructor(private readonly service: PlatformCertService) {}

  @Get()
  @ApiOperation({ summary: 'Ver estado del cert maestro (sin exponer claves)' })
  async status() {
    const material = await this.service.getMaterial();
    if (!material) return { configured: false };
    return { configured: true, cuit: material.cuit };
  }

  @Put()
  @ApiOperation({ summary: 'Cargar o reemplazar el cert maestro de plataforma' })
  async set(@Body() dto: SetPlatformCertDto) {
    await this.service.setMaterial(dto);
    return { ok: true };
  }
}
