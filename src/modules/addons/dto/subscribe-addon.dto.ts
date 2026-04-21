import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl } from 'class-validator';
import { BillingPeriod } from '../../../../generated/prisma';

export class SubscribeAddOnDto {
  @ApiProperty({ example: 'whatsapp-bot' })
  @IsString()
  addonSlug: string;

  @ApiPropertyOptional({ enum: BillingPeriod, default: BillingPeriod.MONTHLY })
  @IsOptional()
  @IsEnum(BillingPeriod)
  billingPeriod?: BillingPeriod;

  @ApiPropertyOptional({
    default: true,
    description:
      'Si true y la org tiene plan pago: prorratea monto del ciclo actual, lo cobra con un Payment one-time ahora, y crea el preapproval recurrente con start_date=cycleEnd (ciclos alineados). Si false o plan free: preapproval inmediato sin alineación.',
  })
  @IsOptional()
  @IsBoolean()
  alignWithMainCycle?: boolean;

  @ApiPropertyOptional({ description: 'URL de retorno post checkout MP' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  backUrl?: string;
}
