import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ResponseDto, PaginationResponseDto, PaginationMetaDto } from '../dto';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse();
        
        // If data is already a response DTO, return it as is
        if (data instanceof ResponseDto || data instanceof PaginationResponseDto) {
          return data;
        }

        // If data has pagination structure, wrap it
        if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
          const { data: items, meta } = data;
          return new PaginationResponseDto(items, meta);
        }

        // Default response
        return new ResponseDto(data);
      }),
    );
  }
}

