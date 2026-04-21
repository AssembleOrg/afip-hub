import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RetentionService } from './retention.service';
import { RequirePlatformRole, WebOnly } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import { PlatformRole } from '../../../generated/prisma';

@ApiTags('Retention (admin)')
@Controller('admin/retention')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@RequirePlatformRole(PlatformRole.ADMIN)
@WebOnly()
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('run')
  @ApiOperation({
    summary: 'Admin: disparar retention ahora (no esperar al cron de las 4am)',
    description:
      'Aplica todas las políticas de retention + archival a DO Spaces. Útil para liberar espacio de urgencia o debug. No afecta datos recientes dentro de la ventana configurada.',
  })
  run() {
    return this.retention.runAll();
  }
}
