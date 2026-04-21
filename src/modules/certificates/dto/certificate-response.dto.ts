// Safe fields only — no cert/key/encrypted columns
export class CertificateResponseDto {
  id: string;
  alias: string;
  cuit: string;
  fingerprint: string;
  notBefore: Date;
  notAfter: Date;
  isActive: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export function mapCertToResponse(row: any): CertificateResponseDto {
  return {
    id: row.id,
    alias: row.alias,
    cuit: row.cuit,
    fingerprint: row.fingerprint,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    isActive: row.isActive,
    lastUsedAt: row.lastUsedAt ?? null,
    createdAt: row.createdAt,
  };
}
