import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Métricas Prometheus centralizadas. Registry aislado (no el global) para no
 * colisionar con otros módulos ni con tests.
 *
 * Convención de labels:
 *  - Nada de labels de alta cardinalidad (ej: no meter orgId — son miles).
 *    Para dashboard por org, consultar UsageCounter/UsageEvent de Postgres.
 *  - Usar labels acotados: method, route, status, service, kind, plan_slug.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  // ---- HTTP ----
  readonly httpRequestsTotal = new Counter({
    name: 'afip_hub_http_requests_total',
    help: 'Total de requests HTTP',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram({
    name: 'afip_hub_http_request_duration_seconds',
    help: 'Latencia de requests HTTP',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });

  // ---- AFIP upstream ----
  readonly afipCallsTotal = new Counter({
    name: 'afip_hub_afip_calls_total',
    help: 'Total de llamadas a AFIP/ARCA (WSAA, WSFE, Padrón, VE, WSCDC)',
    labelNames: ['service', 'status'],
    registers: [this.registry],
  });

  readonly afipCallDuration = new Histogram({
    name: 'afip_hub_afip_call_duration_seconds',
    help: 'Latencia de llamadas a AFIP',
    labelNames: ['service', 'status'],
    buckets: [0.1, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 30, 60],
    registers: [this.registry],
  });

  // ---- Circuit breakers ----
  readonly circuitBreakerState = new Gauge({
    name: 'afip_hub_circuit_breaker_state',
    help: 'Estado del circuit breaker (0=closed, 1=half_open, 2=open)',
    labelNames: ['name'],
    registers: [this.registry],
  });

  // ---- Quota ----
  readonly quotaUsageRatio = new Gauge({
    name: 'afip_hub_quota_usage_ratio',
    help: 'Ratio (0-1+) de uso de quota por plan. >1 = en gracia',
    labelNames: ['plan_slug'],
    registers: [this.registry],
  });

  readonly quotaBlockedTotal = new Counter({
    name: 'afip_hub_quota_blocked_total',
    help: 'Veces que QuotaGuard rechazó un request con 429',
    labelNames: ['plan_slug', 'kind'],
    registers: [this.registry],
  });

  // ---- Billing (MP) ----
  readonly mpPaymentsTotal = new Counter({
    name: 'afip_hub_mp_payments_total',
    help: 'Cobros de MercadoPago procesados',
    labelNames: ['status'], // approved | rejected | refunded | pending
    registers: [this.registry],
  });

  // ---- Scheduled tasks ----
  readonly scheduledTaskRuns = new Counter({
    name: 'afip_hub_scheduled_task_runs_total',
    help: 'Ejecuciones de tareas programadas',
    labelNames: ['type', 'status'], // status: ok | failed | skipped
    registers: [this.registry],
  });

  // ---- DB pool ----
  readonly dbConnectionsActive = new Gauge({
    name: 'afip_hub_db_active_connections',
    help: 'Conexiones Postgres activas (aproximado)',
    registers: [this.registry],
  });

  // ---- DB volume usage (alimentado por StorageAlertsCron) ----
  readonly dbSizeBytes = new Gauge({
    name: 'afip_hub_db_size_bytes',
    help: 'pg_database_size(current_database()) — tamaño total de la DB',
    registers: [this.registry],
  });

  readonly dbUsageRatio = new Gauge({
    name: 'afip_hub_db_usage_ratio',
    help: 'Ratio de uso del volumen (0-1). >0.9 = urgente',
    registers: [this.registry],
  });

  readonly dbTableSizeBytes = new Gauge({
    name: 'afip_hub_db_table_size_bytes',
    help: 'pg_total_relation_size por tabla (top 10) — útil para alertas granulares',
    labelNames: ['table'],
    registers: [this.registry],
  });

  // ---- Org accounting ----
  readonly organizationsTotal = new Gauge({
    name: 'afip_hub_organizations_total',
    help: 'Total de organizaciones activas por estado de suscripción',
    labelNames: ['subscription_status'],
    registers: [this.registry],
  });

  onModuleInit() {
    // Métricas por defecto de Node (gc, event loop lag, mem, cpu).
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'afip_hub_process_',
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
