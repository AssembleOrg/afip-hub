import { Request } from 'express';

export function getClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
  }
  return request.ip || request.socket.remoteAddress || 'unknown';
}

