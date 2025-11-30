import { ApiProperty } from '@nestjs/swagger';

export class AfipTicketDto {
  @ApiProperty()
  token: string;

  @ApiProperty()
  sign: string;

  @ApiProperty()
  expirationTime: string;

  @ApiProperty()
  generationTime: string;
}

