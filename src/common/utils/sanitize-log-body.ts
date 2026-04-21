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
