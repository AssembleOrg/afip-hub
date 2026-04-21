import { Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';

/**
 * Wrapper de resiliencia: retries con exponential backoff + jitter, y un
 * circuit breaker simple (closed → open → half-open) compartido por nombre.
 *
 * Pensado para llamadas a AFIP (SOAP). Cuando AFIP está caído, evita que
 * cada request se quede 30s esperando — abre el circuito y falla rápido.
 *
 * Cada call (incluyendo retries) genera un OpenTelemetry span así se ve en
 * Jaeger/Tempo/Grafana: duración, attempts, status, errores.
 */

interface BreakerState {
  failuresInWindow: number[];   // timestamps ms de fallos recientes
  state: 'closed' | 'open' | 'half-open';
  openedAt: number;
}

const breakers = new Map<string, BreakerState>();
const log = new Logger('ResilientCall');
const tracer = trace.getTracer('afip-hub/resilient-call');

export interface ResilientOptions {
  /** Identificador del circuito (varios calls al mismo target lo comparten). */
  name: string;
  /** Cantidad máxima de intentos (incluye el primero). Default: 3 */
  maxAttempts?: number;
  /** Backoff base en ms. Default: 500. Cada intento = base × 2^(n-1) + jitter */
  baseBackoffMs?: number;
  /** Timeout por intento individual en ms. Default: 30000 */
  perAttemptTimeoutMs?: number;
  /** Cuántos fallos en `breakerWindowMs` abren el circuito. Default: 8 */
  breakerThreshold?: number;
  /** Ventana de evaluación del breaker en ms. Default: 60_000 */
  breakerWindowMs?: number;
  /** Tiempo en open antes de pasar a half-open. Default: 30_000 */
  breakerCooldownMs?: number;
  /** Función para decidir si un error es retryable. Default: cualquiera. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export class CircuitOpenError extends Error {
  constructor(name: string, public retryAfterMs: number) {
    super(
      `Circuit breaker "${name}" abierto: AFIP/upstream con fallos repetidos. Reintentar en ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = 'CircuitOpenError';
  }
}

export async function resilientCall<T>(
  fn: () => Promise<T>,
  opts: ResilientOptions,
): Promise<T> {
  const name = opts.name;
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseBackoffMs = opts.baseBackoffMs ?? 500;
  const perAttemptTimeoutMs = opts.perAttemptTimeoutMs ?? 30_000;
  const breakerThreshold = opts.breakerThreshold ?? 8;
  const breakerWindowMs = opts.breakerWindowMs ?? 60_000;
  const breakerCooldownMs = opts.breakerCooldownMs ?? 30_000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  const breaker = getBreaker(name);
  checkBreaker(breaker, name, breakerCooldownMs);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const span = tracer.startSpan(`afip.upstream.${name}`, {
      attributes: {
        'afip.upstream.name': name,
        'afip.upstream.attempt': attempt,
        'afip.upstream.max_attempts': maxAttempts,
        'afip.upstream.breaker_state': breaker.state,
      },
    });

    try {
      const result = await withTimeout(fn(), perAttemptTimeoutMs);
      // Éxito → si estaba half-open, cerramos.
      if (breaker.state !== 'closed') {
        breaker.state = 'closed';
        breaker.failuresInWindow = [];
        log.log(`Circuit "${name}" cerrado tras éxito en half-open`);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (err) {
      lastErr = err;
      recordFailure(breaker, breakerWindowMs);
      const errMsg = String((err as Error)?.message ?? err);
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg.slice(0, 200) });
      span.end();

      if (
        breaker.failuresInWindow.length >= breakerThreshold &&
        breaker.state !== 'open'
      ) {
        breaker.state = 'open';
        breaker.openedAt = Date.now();
        log.error(
          `Circuit "${name}" ABIERTO (${breaker.failuresInWindow.length} fallos en ${breakerWindowMs}ms)`,
        );
      }

      const retryable = attempt < maxAttempts && shouldRetry(err, attempt);
      if (!retryable) break;

      const backoff = computeBackoff(baseBackoffMs, attempt);
      log.warn(
        `Intento ${attempt}/${maxAttempts} falló para "${name}" (${(err as Error)?.message ?? err}); reintento en ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function getBreaker(name: string): BreakerState {
  let b = breakers.get(name);
  if (!b) {
    b = { failuresInWindow: [], state: 'closed', openedAt: 0 };
    breakers.set(name, b);
  }
  return b;
}

function checkBreaker(b: BreakerState, name: string, cooldownMs: number): void {
  if (b.state !== 'open') return;
  const elapsed = Date.now() - b.openedAt;
  if (elapsed < cooldownMs) {
    throw new CircuitOpenError(name, cooldownMs - elapsed);
  }
  // Cooldown vencido → half-open: dejamos pasar 1 request de prueba.
  b.state = 'half-open';
  log.log(`Circuit "${name}" pasa a HALF-OPEN (probe)`);
}

function recordFailure(b: BreakerState, windowMs: number) {
  const now = Date.now();
  b.failuresInWindow.push(now);
  // limpiamos viejos fuera de ventana
  const cutoff = now - windowMs;
  while (b.failuresInWindow.length > 0 && b.failuresInWindow[0] < cutoff) {
    b.failuresInWindow.shift();
  }
}

function computeBackoff(base: number, attempt: number): number {
  const exp = base * 2 ** (attempt - 1);
  const jitter = Math.random() * exp * 0.3; // ±30%
  return Math.floor(exp + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout tras ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Helper para tests / admin: estado actual de circuitos. */
export function getCircuitsSnapshot(): Array<{
  name: string;
  state: string;
  failures: number;
  openedAt: number;
}> {
  return Array.from(breakers.entries()).map(([name, b]) => ({
    name,
    state: b.state,
    failures: b.failuresInWindow.length,
    openedAt: b.openedAt,
  }));
}
