import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OverviewOverageDto {
  @ApiProperty({ description: 'Comprobantes por encima del cupo' }) comprobantes!: number;
  @ApiProperty({ description: 'PDFs por encima del cupo' }) pdfs!: number;
  @ApiProperty({ description: 'Excedente acumulado del ciclo en USD' }) usd!: number;
  @ApiProperty() arsEstimate!: number;
  @ApiProperty({ description: 'USD por comprobante extra (0 = sin excedente)' }) priceUsd!: number;
  @ApiProperty({ description: 'USD por PDF extra (0 = sin excedente)' }) pdfPriceUsd!: number;
}

export class OverviewUsageDto {
  @ApiProperty({ description: 'Comprobantes emitidos (aprobados) en el ciclo' })
  billableCount!: number;
  @ApiProperty() pdfCount!: number;
  @ApiProperty() taCount!: number;
  @ApiProperty({ description: 'Comprobantes incluidos en el plan' }) limit!: number;
  @ApiProperty({ description: 'PDFs incluidos en el plan' }) pdfLimit!: number;
  @ApiProperty({ description: 'Comprobantes de regalo del ciclo (se suman al cupo)' }) bonus!: number;
  @ApiProperty({ type: OverviewOverageDto }) overage!: OverviewOverageDto;
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
