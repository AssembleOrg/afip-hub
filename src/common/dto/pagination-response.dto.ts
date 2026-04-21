import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from './pagination-meta.dto';

export class PaginationResponseDto<T> {
  @ApiProperty()
  data: T[];

  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty()
  timestamp: string;

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;

  @ApiProperty()
  requestId: string;

  @ApiProperty()
  path: string;

  @ApiProperty()
  requestType: string;

  constructor(
    data: T[],
    paginationMeta: PaginationMetaDto,
    requestMeta?: { requestId: string; path: string; requestType: string },
    message = 'Operación exitosa',
  ) {
    this.data = data;
    this.success = true;
    this.message = message;
    this.timestamp = new Date().toISOString();
    this.meta = paginationMeta;
    this.requestId = requestMeta?.requestId ?? '';
    this.path = requestMeta?.path ?? '';
    this.requestType = requestMeta?.requestType ?? '';
  }
}

