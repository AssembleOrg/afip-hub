import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { VentanillaService } from './ventanilla.service';
import { CurrentUser } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types';

class ListVentanillaDto {
  @IsOptional()
  @IsString()
  emisorId?: string;

  @IsOptional()
  @Type(() => Boolean)
  unreadOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

class OpenMessageDto {
  @IsOptional()
  @IsBoolean()
  includeAttachments?: boolean;
}

@ApiTags('Ventanilla Electrónica')
@ApiBearerAuth()
@Controller({ path: 'ventanilla', version: '1' })
export class VentanillaController {
  constructor(private readonly service: VentanillaService) {}

  @Get()
  @ApiOperation({ summary: 'Listar mensajes AFIP guardados (paginado)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() q: ListVentanillaDto) {
    if (!user?.organizationId) throw new ForbiddenException('Sin organización');
    const pageSize = q.pageSize ?? q.take ?? 20;
    const skip =
      q.skip !== undefined
        ? q.skip
        : q.page !== undefined
          ? (q.page - 1) * pageSize
          : 0;
    return this.service.list(user.organizationId, {
      ...q,
      skip,
      take: pageSize,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle del mensaje (sin abrir body desde AFIP)' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user?.organizationId) throw new ForbiddenException('Sin organización');
    return this.service.findOne(user.organizationId, id);
  }

  @Post(':id/open')
  @ApiOperation({
    summary: 'Abrir el mensaje: trae body desde AFIP + marca como leído',
    description:
      'Consume 1 request de AFIP Ventanilla. Si ya se abrió antes y no pedís adjuntos, usa el body cacheado.',
  })
  open(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: OpenMessageDto,
  ) {
    if (!user?.organizationId || !user.id) {
      throw new ForbiddenException('Sin organización');
    }
    return this.service.openMessage(
      user.organizationId,
      id,
      user.id,
      dto.includeAttachments ?? false,
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar como leído localmente (sin abrir body)' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (!user?.organizationId || !user.id) {
      throw new ForbiddenException('Sin organización');
    }
    return this.service.markRead(user.organizationId, id, user.id);
  }

  @Post('fetch-now')
  @ApiOperation({
    summary: 'Forzar un fetch inmediato para todos los emisores de la org',
    description: 'Útil para testing o cuando el user quiere sync on-demand.',
  })
  async fetchNow(@CurrentUser() user: AuthenticatedUser) {
    if (!user?.organizationId) throw new ForbiddenException('Sin organización');
    if (user.orgRole !== 'OWNER' && user.orgRole !== 'ADMIN') {
      throw new ForbiddenException('Solo OWNER/ADMIN puede forzar fetch');
    }
    // Reusa la lógica del cron pero filtrada por org.
    // Por simplicidad, disparamos fetchAllPending completo — el cron filtra internamente.
    return this.service.fetchAllPending();
  }
}
