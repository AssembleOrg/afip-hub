import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  message: string;

  @ApiProperty()
  timestamp: string;

  @ApiProperty({ required: false })
  errors?: string[];

  constructor(message: string, errors?: string[]) {
    this.success = false;
    this.message = message;
    this.timestamp = new Date().toISOString();
    if (errors) {
      this.errors = errors;
    }
  }
}

