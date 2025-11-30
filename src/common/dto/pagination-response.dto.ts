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

  constructor(
    data: T[],
    meta: PaginationMetaDto,
    message = 'Operación exitosa',
  ) {
    this.data = data;
    this.success = true;
    this.message = message;
    this.timestamp = new Date().toISOString();
    this.meta = meta;
  }
}

