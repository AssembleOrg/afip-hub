import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ChangePlanDto {
  @ApiProperty({ example: 'growth' })
  @IsString()
  @IsNotEmpty()
  planSlug: string;
}
