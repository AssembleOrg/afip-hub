import { ApiProperty } from '@nestjs/swagger';

export class AdminOverviewStatsDto {
  @ApiProperty() activeOrgs!: number;
  @ApiProperty() newOrgsThisWeek!: number;
  @ApiProperty() mrrUsd!: number;
  @ApiProperty() mrrArs!: number;
  @ApiProperty() requestsThisMonth!: number;
  @ApiProperty() p99LatencyMs!: number;
  @ApiProperty() dbUsedBytes!: number;
  @ApiProperty() dbLimitBytes!: number;
  @ApiProperty() dbUsagePercent!: number;
}

export class AdminPlanDistributionItemDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceUsd!: number;
  @ApiProperty() orgs!: number;
  @ApiProperty() percent!: number;
}

export class AdminUpstreamStatusDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['healthy', 'degraded', 'down'] })
  status!: 'healthy' | 'degraded' | 'down';
  @ApiProperty({ required: false }) latencyMs?: number;
  @ApiProperty({ required: false }) detail?: string;
}

export class AdminOverviewResponseDto {
  @ApiProperty() stats!: AdminOverviewStatsDto;
  @ApiProperty({ type: [AdminPlanDistributionItemDto] })
  planDistribution!: AdminPlanDistributionItemDto[];
  @ApiProperty({ type: [AdminUpstreamStatusDto] })
  upstreams!: AdminUpstreamStatusDto[];
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
}
