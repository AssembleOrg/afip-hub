import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '@/database/prisma.service';
import { RedisService } from '@/infra/redis';
import { Public } from '@/common/decorators';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({
    summary: 'Liveness: el proceso responde',
    description: 'Barato. No chequea dependencias externas.',
  })
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Public()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness: dependencias críticas',
    description:
      'Chequea DB (crítico) y Redis (si está configurado). Redis caído no rompe readiness porque la app sigue funcionando degradada.',
  })
  async ready() {
    const result: Record<string, any> = { status: 'ok', checks: {} };

    // DB (crítico)
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      result.checks.database = 'ok';
    } catch (err) {
      result.checks.database = `down: ${String(err).slice(0, 120)}`;
      result.status = 'degraded';
    }

    // Redis (opcional)
    if (this.redis.isAvailable()) {
      const ping = await this.redis.safeCall((r) => r.ping());
      result.checks.redis = ping.ok && ping.value === 'PONG' ? 'ok' : 'down';
    } else {
      result.checks.redis = 'not_configured';
    }

    return result;
  }
}
