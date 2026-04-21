import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

/**
 * Inicializa OpenTelemetry tracing si `OTEL_EXPORTER_OTLP_ENDPOINT` está
 * configurado. Llamar **antes** de cualquier otro import de la app (los
 * instrumentation patches monkeypatean módulos al require).
 *
 * Targets soportados de exporter OTLP/HTTP:
 *  - Grafana Tempo (vía Grafana Agent)
 *  - Jaeger 1.35+ con OTLP enabled
 *  - Honeycomb, Lightstep, SigNoz, etc.
 *
 * Sin la env var el SDK no arranca y la app funciona igual sin tracing.
 */
export function initTracing(): boolean {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return false;
  if (process.env.OTEL_TRACES_ENABLED === 'false') return false;

  const serviceName = process.env.OTEL_SERVICE_NAME || 'afip-hub';
  const serviceVersion = process.env.npm_package_version || '1.0.0';

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    headers: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment':
        process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    }),
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Silenciamos fs/net (mucho ruido) y pg-native (viene con pg auto)
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Shutdown graceful
  process.once('SIGTERM', () => {
    void sdk?.shutdown();
  });

  console.log(
    `[otel] Tracing inicializado: service=${serviceName} endpoint=${endpoint}`,
  );
  return true;
}

function parseHeaders(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined;
  // Formato OTEL estándar: "key1=value1,key2=value2"
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [k, ...rest] = pair.split('=');
    if (!k || rest.length === 0) continue;
    out[k.trim()] = rest.join('=').trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
