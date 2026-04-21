import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of, tap, from, switchMap } from 'rxjs';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';
import { IdempotencyService } from '@/modules/idempotency/idempotency.service';
import { SaasRequest } from '../types/request-context';

const HEADER_NAME = 'idempotency-key';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly service: IdempotencyService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isIdempotent = this.reflector.getAllAndOverride<boolean>(
      IDEMPOTENT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!isIdempotent) return next.handle();

    const http = ctx.switchToHttp();
    const req = http.getRequest<SaasRequest>();
    const res = http.getResponse();
    const key = String(req.headers[HEADER_NAME] || '').trim();
    const org = req.organization;

    // Sin header → endpoint funciona como siempre, sin cache.
    if (!key || !org) return next.handle();

    const bodyHash = this.service.hashBody(req.body);

    return from(
      this.service.lookup({
        organizationId: org.id,
        key,
        bodyHash,
      }),
    ).pipe(
      switchMap((cached) => {
        if (cached) {
          // Replay: seteamos el statusCode y devolvemos el body cacheado.
          // El ResponseInterceptor lo dejará pasar tal cual si es DTO o lo envuelve.
          res.status(cached.statusCode);
          res.setHeader('X-Idempotent-Replay', 'true');
          this.logger.debug(
            `Replay idempotency key=${key} org=${org.id} → ${cached.statusCode}`,
          );
          return of(cached.body);
        }

        return next.handle().pipe(
          tap((response) => {
            // Solo cacheamos respuestas exitosas. Errores se manejan vía catchError
            // del ResponseInterceptor; no queremos cachear 4xx/5xx para que se
            // pueda reintentar tras corregir.
            const statusCode = res.statusCode ?? 200;
            if (statusCode >= 200 && statusCode < 300) {
              void this.service.store({
                organizationId: org.id,
                key,
                endpoint: req.route?.path ?? req.originalUrl?.split('?')[0] ?? req.url,
                method: req.method,
                bodyHash,
                statusCode,
                responseBody: response,
              });
            }
          }),
        );
      }),
    );
  }
}
