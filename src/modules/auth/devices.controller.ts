import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { WebOnly } from '@/common/decorators';
import type { SaasRequest } from '@/common/types/request-context';

@ApiTags('auth')
@Controller('auth/sessions')
@WebOnly()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(
    @Req() req: SaasRequest,
    @Query('currentSessionId') currentSessionId?: string,
  ) {
    const userId = req.user!.id;
    return this.devices.listSessions(userId, currentSessionId ?? null);
  }

  @Delete('others')
  revokeOthers(
    @Req() req: SaasRequest,
    @Query('currentSessionId') currentSessionId?: string,
  ) {
    return this.devices
      .revokeAllOtherSessions(req.user!.id, currentSessionId ?? null)
      .then(() => ({ ok: true }));
  }

  @Delete(':sessionId')
  revoke(@Req() req: SaasRequest, @Param('sessionId') sessionId: string) {
    return this.devices
      .revokeSession(req.user!.id, sessionId)
      .then(() => ({ ok: true }));
  }
}
