const SENSITIVE_KEYS = new Set([
  'certificate', 'privateKey', 'crtFile', 'keyFile',
  'certificado', 'clavePrivada', 'encryptedPayload',
]);

export function sanitizeLogBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : value;
  }
  return result;
}

const PEM_RE = /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)/;

/** Clona en profundidad y enmascara claves sensibles y PEM (cert/clave). */
function deepRedact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return PEM_RE.test(value) ? '[REDACTED]' : value;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : deepRedact(v, seen);
  }
  return out;
}

/**
 * Reemplazo directo de JSON.stringify para logs: enmascara cert/clave privada
 * (por nombre de campo y por contenido PEM) en cualquier nivel. Firma compatible
 * con JSON.stringify(value, replacer, space) — el replacer se ignora.
 */
export function safeStringify(
  value: unknown,
  _replacer?: unknown,
  space: number = 2,
): string {
  try {
    return JSON.stringify(deepRedact(value), null, space);
  } catch {
    return '[unserializable]';
  }
}
