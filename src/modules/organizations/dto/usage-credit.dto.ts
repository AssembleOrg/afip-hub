import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UsageCreditDto {
  @ApiProperty({ description: 'Comprobantes de regalo a sumar al cupo del ciclo actual', example: 50 })
  @IsInt()
  @Min(1)
  @Max(100000)
  comprobantes!: number;

  @ApiProperty({ description: 'Motivo (queda en auditoría)', example: 'Caída de ARCA 02/10 14:00–15:30' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
