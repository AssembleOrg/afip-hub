import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Request, Response } from 'express';
import { ErrorResponseDto } from '../dto';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Error interno del servidor';

    // Log del error real para 500s no-HTTP (nos salvaría horas de debug).
    if (status >= 500 && !(exception instanceof HttpException)) {
      const err = exception as Error;
      this.logger.error(
        `Unhandled ${request.method} ${request.originalUrl ?? request.url}: ${err?.message ?? String(exception)}`,
        err?.stack,
      );
    }

    let errorMessage: string;
    let errors: string[] | undefined;
    let code: string | undefined;

    if (typeof message === 'string') {
      errorMessage = message;
    } else if (typeof message === 'object' && message !== null) {
      const msg = message as any;
      errorMessage = msg.message || 'Error desconocido';
      code = typeof msg.code === 'string' ? msg.code : undefined;
      if (Array.isArray(msg.message)) {
        errors = msg.message;
        errorMessage = 'Error de validación';
      }
    } else {
      errorMessage = 'Error desconocido';
    }

    const requestIdHeader = request.headers['x-request-id'];
    const requestId =
      (typeof requestIdHeader === 'string' && requestIdHeader.trim()) ||
      (Array.isArray(requestIdHeader) && requestIdHeader[0]?.trim()) ||
      crypto.randomUUID();
    response.setHeader('x-request-id', requestId);

    const errorResponse = new ErrorResponseDto({
      statusCode: status,
      message: errorMessage,
      path: request.originalUrl?.split('?')[0] ?? request.url ?? '',
      requestType: request.method ?? 'UNKNOWN',
      requestId,
      errors,
      code,
    });

    response.status(status).json(errorResponse);
  }
}
