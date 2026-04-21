import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import * as crypto from 'node:crypto';
import { Request, Response } from 'express';
import { ResponseDto, PaginationResponseDto, PaginationMetaDto } from '../dto';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const requestIdHeader = request.headers['x-request-id'];
    const requestId =
      (typeof requestIdHeader === 'string' && requestIdHeader.trim()) ||
      (Array.isArray(requestIdHeader) && requestIdHeader[0]?.trim()) ||
      crypto.randomUUID();
    response.setHeader('x-request-id', requestId);

    const requestMeta = {
      requestId,
      path: (request.originalUrl?.split('?')[0] ?? request.url ?? ''),
      requestType: request.method ?? 'UNKNOWN',
    };

    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) {
          return data;
        }

        let dto: ResponseDto<unknown> | PaginationResponseDto<unknown>;

        if (data instanceof ResponseDto || data instanceof PaginationResponseDto) {
          dto = data;
        } else if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
          const { data: items, meta } = data as { data: unknown[]; meta: PaginationMetaDto };
          dto = new PaginationResponseDto(items, meta);
        } else {
          dto = new ResponseDto(data);
        }

        // Inject request metadata into every response
        dto.requestId = requestMeta.requestId;
        dto.path = requestMeta.path;
        dto.requestType = requestMeta.requestType;

        return dto;
      }),
    );
  }
}

