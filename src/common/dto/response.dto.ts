import { ApiProperty } from '@nestjs/swagger';

export class ResponseDto<T> {
  @ApiProperty()
  data: T;

  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty()
  timestamp: string;

  @ApiProperty()
  requestId: string;

  @ApiProperty()
  path: string;

  @ApiProperty()
  requestType: string;

  constructor(
    data: T,
    metaOrMessage?: { requestId: string; path: string; requestType: string } | string,
    message = 'Operación exitosa',
  ) {
    this.data = data;
    this.success = true;
    this.timestamp = new Date().toISOString();

    if (typeof metaOrMessage === 'string') {
      this.message = metaOrMessage;
      this.requestId = '';
      this.path = '';
      this.requestType = '';
    } else if (metaOrMessage) {
      this.message = message;
      this.requestId = metaOrMessage.requestId;
      this.path = metaOrMessage.path;
      this.requestType = metaOrMessage.requestType;
    } else {
      this.message = message;
      this.requestId = '';
      this.path = '';
      this.requestType = '';
    }
  }
}

