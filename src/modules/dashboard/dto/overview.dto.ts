import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OverviewUsageDto {
  @ApiProperty() billableCount!: number;
  @ApiProperty() pdfCount!: number;
  @ApiProperty() taCount!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ description: '0-100 (puede exceder si está en grace)' })
  percentUsed!: number;
  @ApiProperty({ description: 'Días restantes del ciclo' }) daysLeft!: number;
}

export class OverviewInvoicesDto {
  @ApiProperty() totalThisPeriod!: number;
  @ApiProperty() totalAmountArs!: number;
  @ApiProperty({ description: 'Total del período anterior' })
  totalLastPeriod!: number;
  @ApiProperty({ description: 'Variación % respecto al período anterior' })
  percentChange!: number;
}

export class OverviewErrorsDto {
  @ApiProperty() last24hCount!: number;
  @ApiProperty({ description: 'Facturas reintentándose en este momento' })
  retryingCount!: number;
}

export class OverviewBillingDto {
  @ApiProperty() planSlug!: string;
  @ApiProperty() planName!: string;
  @ApiProperty() priceUsd!: number;
  @ApiProperty() priceArsEstimate!: number;
  @ApiProperty() blueRate!: number;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  nextChargeAt?: string | null;
}

export class OverviewChartPointDto {
  @ApiProperty({ description: 'ISO date (YYYY-MM-DD)' }) date!: string;
  @ApiProperty() total!: number;
  @ApiProperty() errors!: number;
}

export class OverviewRecentInvoiceDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: 'date-time' }) fechaComprobante!: string;
  @ApiProperty() tipoComprobante!: number;
  @ApiProperty() puntoVenta!: number;
  @ApiProperty({ type: 'string' }) numeroComprobante!: string;
  @ApiPropertyOptional() receptorNombre?: string | null;
  @ApiPropertyOptional() receptorNroDoc?: string | null;
  @ApiProperty() cae!: string;
  @ApiProperty() importeTotal!: number;
}

export class OverviewResponseDto {
  @ApiProperty() organizationId!: string;
  @ApiProperty({ format: 'date-time' }) periodStart!: string;
  @ApiProperty({ format: 'date-time' }) periodEnd!: string;
  @ApiProperty({ type: OverviewUsageDto }) usage!: OverviewUsageDto;
  @ApiProperty({ type: OverviewInvoicesDto }) invoices!: OverviewInvoicesDto;
  @ApiProperty({ type: OverviewErrorsDto }) errors!: OverviewErrorsDto;
  @ApiProperty({ type: OverviewBillingDto }) billing!: OverviewBillingDto;
  @ApiProperty({ type: [OverviewChartPointDto] })
  requestsPerDay!: OverviewChartPointDto[];
  @ApiProperty({ type: [OverviewRecentInvoiceDto] })
  recentInvoices!: OverviewRecentInvoiceDto[];
}
