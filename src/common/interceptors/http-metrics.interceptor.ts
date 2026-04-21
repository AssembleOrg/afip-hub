import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { MetricsService } from '@/modules/metrics/metrics.service';
import { SaasRequest } from '../types/request-context';

/**
 * Registra `http_requests_total` y `http_request_duration_seconds` para cada
 * request. Usa `req.route.path` (template) para no generar labels por cada ID
 * único, evitando explosión de cardinalidad.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<SaasRequest>();
    const res = http.getResponse();
    const started = process.hrtime.bigint();

    return next.handle().pipe(
      tap(() => this.finish(req, res.statusCode ?? 200, started)),
      catchError((err) => {
        const status = err?.status ?? err?.getStatus?.() ?? 500;
        this.finish(req, status, started);
        return throwError(() => err);
      }),
    );
  }

  private finish(req: SaasRequest, statusCode: number, started: bigint): void {
    const route =
      req.route?.path ??
      req.originalUrl?.split('?')[0]?.replace(/\/[0-9a-f-]{10,}/g, '/:id') ??
      req.url ??
      'unknown';
    const labels = {
      method: req.method,
      route,
      status: String(statusCode),
    };
    const elapsedNs = Number(process.hrtime.bigint() - started);
    const elapsedSec = elapsedNs / 1e9;

    this.metrics.httpRequestsTotal.inc(labels);
    this.metrics.httpRequestDuration.observe(labels, elapsedSec);
  }
}
