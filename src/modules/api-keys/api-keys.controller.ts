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
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto';
import { CurrentUser, RequireVerified, WebOnly } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types';

@ApiTags('API Keys')
@Controller('api-keys')
@ApiBearerAuth()
@RequireVerified()
@WebOnly()
export class ApiKeysController {
  constructor(
    private readonly service: ApiKeysService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Crear una API key para la organización del usuario',
    description:
      'La key solo se muestra una vez en la respuesta. Guardala bien — después solo se ve el prefijo.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateApiKeyDto) {
    this.assertOrgMember(user);
    const env =
      (this.configService.get<string>('afip.environment') as
        | 'production'
        | 'homologacion') ?? 'homologacion';
    return this.service.create(user.organizationId!, user.id, dto, env);
  }

  @Get()
  @ApiOperation({ summary: 'Listar las API keys de la organización' })
  list(@CurrentUser() user: AuthenticatedUser) {
    this.assertOrgMember(user);
    return this.service.list(user.organizationId!);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revocar una API key' })
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    this.assertOrgMember(user);
    return this.service.revoke(user.organizationId!, id, user.id);
  }

  private assertOrgMember(user: AuthenticatedUser | undefined): void {
    if (!user?.organizationId) {
      throw new ForbiddenException(
        'Este usuario no pertenece a ninguna organización',
      );
    }
    if (user.orgRole !== 'OWNER' && user.orgRole !== 'ADMIN') {
      throw new ForbiddenException(
        'Solo OWNER o ADMIN de la organización puede gestionar API keys',
      );
    }
  }
}
