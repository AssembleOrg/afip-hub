import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  statusCode: number;

  @ApiProperty()
  message: string;

  @ApiProperty()
  timestamp: string;

  @ApiProperty()
  path: string;

  @ApiProperty({
    description: 'Método HTTP de la request que generó el error',
    example: 'POST',
  })
  requestType: string;

  @ApiProperty()
  requestId: string;

  @ApiProperty({ required: false })
  errors?: string[];

  @ApiProperty({ required: false })
  code?: string;

  constructor(params: {
    statusCode: number;
    message: string;
    path: string;
    requestType: string;
    requestId: string;
    errors?: string[];
    code?: string;
  }) {
    this.success = false;
    this.statusCode = params.statusCode;
    this.message = params.message;
    this.timestamp = new Date().toISOString();
    this.path = params.path;
    this.requestType = params.requestType;
    this.requestId = params.requestId;
    if (params.errors) {
      this.errors = params.errors;
    }
    if (params.code) {
      this.code = params.code;
    }
  }
}
