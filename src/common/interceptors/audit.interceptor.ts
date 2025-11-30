import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDITORY_KEY } from '../decorators/auditory.decorator';
import { getClientIp } from '../utils/ip.util';
import { getLocationFromIp } from '../utils/location.util';
import { Request } from 'express';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const handler = context.getHandler();
    const controller = context.getClass();

    const auditAction = this.reflector.getAllAndOverride<string | boolean>(
      AUDITORY_KEY,
      [handler, controller],
    );

    if (!auditAction) {
      return next.handle();
    }

    const method = request.method;
    const url = request.url;
    const ip = getClientIp(request);
    const location = await getLocationFromIp(ip);
    const user = (request as any).user;

    // TODO: Save audit log to database
    // You can create an AuditLog model in Prisma and save here
    console.log('Audit Log:', {
      action: auditAction === true ? `${method} ${url}` : auditAction,
      method,
      url,
      ip,
      location,
      userId: user?.id,
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap(() => {
        // Log successful operation
      }),
    );
  }
}

