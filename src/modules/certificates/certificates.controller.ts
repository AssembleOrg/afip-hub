import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CertificatesService } from './certificates.service';
import { CreateCertificateDto } from './dto';
import { CurrentUser, WebOnly } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types';

@ApiTags('Certificates')
@Controller('certificates')
@ApiBearerAuth()
@WebOnly()
export class CertificatesController {
  constructor(private readonly service: CertificatesService) {}

  @Post()
  @ApiOperation({
    summary:
      'Subir un certificado AFIP cifrado en DB (opt-in, requerido para ScheduledTasks)',
    description:
      'El cert + key se guardan cifrados con AES-256-GCM usando una clave maestra externa (`CERT_MASTER_KEY`). La DB solo conserva metadata en claro (CUIT, fingerprint, vencimiento). No se devuelve el material sensible después.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCertificateDto,
  ) {
    this.assertOwnerOrAdmin(user);
    return this.service.create({
      organizationId: user.organizationId!,
      createdByUserId: user.id,
      dto,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Listar certificados de la org (sin material sensible)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    this.assertOrgMember(user);
    return this.service.list(user.organizationId!);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un certificado (sin material sensible)' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOrgMember(user);
    return this.service.get(user.organizationId!, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar certificado cifrado + soft-delete en DB',
    description:
      'Falla si hay ScheduledTasks activas usándolo. Desactiválas o reasignálas primero.',
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOwnerOrAdmin(user);
    return this.service.remove(user.organizationId!, id, user.id);
  }

  private assertOrgMember(user: AuthenticatedUser | undefined): void {
    if (!user?.organizationId) {
      throw new ForbiddenException('Sin organización');
    }
  }

  private assertOwnerOrAdmin(user: AuthenticatedUser | undefined): void {
    this.assertOrgMember(user);
    if (user!.orgRole !== 'OWNER' && user!.orgRole !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo OWNER o ADMIN puede gestionar certificados',
      );
    }
  }
}
