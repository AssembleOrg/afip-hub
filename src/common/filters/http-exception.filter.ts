import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponseDto } from '../dto';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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

    let errorMessage: string;
    let errors: string[] | undefined;

    if (typeof message === 'string') {
      errorMessage = message;
    } else if (typeof message === 'object' && message !== null) {
      const msg = message as any;
      errorMessage = msg.message || 'Error desconocido';
      if (Array.isArray(msg.message)) {
        errors = msg.message;
        errorMessage = 'Error de validación';
      }
    } else {
      errorMessage = 'Error desconocido';
    }

    const errorResponse = new ErrorResponseDto(errorMessage, errors);

    response.status(status).json(errorResponse);
  }
}

