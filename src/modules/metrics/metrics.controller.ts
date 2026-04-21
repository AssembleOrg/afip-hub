import {
  Controller,
  Get,
  Header,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';
import { Public } from '@/common/decorators';

/**
 * Endpoint `GET /metrics` en formato Prometheus. Se autentica con header
 * `Authorization: Bearer <METRICS_TOKEN>` (env var). Si no está seteado el
 * token, queda abierto (dev).
 *
 * Usamos `@Res()` para escribir texto plano directamente — el
 * ResponseInterceptor global envuelve cada response con `{data, success, ...}`
 * y Prometheus rechaza ese JSON.
 */
@Controller('metrics')
@ApiExcludeController()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(
    @Res() res: Response,
    @Headers('authorization') auth?: string,
  ): Promise<void> {
    const expected = this.config.get<string>('metrics.token');
    if (expected) {
      const got = auth?.replace(/^Bearer\s+/i, '').trim();
      if (got !== expected) {
        throw new UnauthorizedException('token inválido');
      }
    }
    const body = await this.metrics.render();
    res.setHeader('Content-Type', this.metrics.contentType);
    res.status(200).send(body);
  }
}
