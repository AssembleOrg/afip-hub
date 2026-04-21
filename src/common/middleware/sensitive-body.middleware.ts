import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

const SENSITIVE_KEYS = new Set([
  'certificate', 'privateKey', 'crtFile', 'keyFile',
  'certificado', 'clavePrivada',
]);

@Injectable()
export class SensitiveBodyMiddleware implements NestMiddleware {
  use(req: Request & { sanitizedBody?: unknown }, _res: Response, next: NextFunction): void {
    const body = req.body as Record<string, unknown> | undefined;
    if (body && typeof body === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        sanitized[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : v;
      }
      req.sanitizedBody = sanitized;
    } else {
      req.sanitizedBody = req.body;
    }
    next();
  }
}
