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

  constructor(data: T, message = 'Operación exitosa') {
    this.data = data;
    this.success = true;
    this.message = message;
    this.timestamp = new Date().toISOString();
  }
}

