import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExchangeRateService } from './exchange-rate.service';
import { Public, RequirePlatformRole } from '@/common/decorators';
import { PlatformRoleGuard } from '@/common/guards/platform-role.guard';
import { PlatformRole } from '../../../generated/prisma';

@ApiTags('Exchange Rate')
@Controller('exchange-rate')
export class ExchangeRateController {
  constructor(private readonly service: ExchangeRateService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Cotización actual (dólar blue)' })
  async current() {
    return this.service.getCurrent();
  }

  @Post('refresh')
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole(PlatformRole.ADMIN)
  @ApiOperation({ summary: 'Admin: forzar refresco de cotización (no esperar cron)' })
  async refresh() {
    return this.service.fetchAndPersist();
  }
}
