export type EmisorStatus = 'VALID' | 'PENDING' | 'INVALID' | 'REVOKED';

export class EmisorResponseDto {
  id: string;
  cuit: string;
  alias: string | null;
  razonSocial: string | null;
  condicionIva: string | null;
  puntoVenta: number | null;
  certMode: string;
  status: EmisorStatus;
  hasCertificate: boolean;
  certificateAlias: string | null;
  certificateExpiresAt: Date | null;
  lastValidatedAt: Date | null;
  invoicesThisPeriod: number;
  createdAt: Date;
}

export function mapEmisorToResponse(row: any): EmisorResponseDto {
  const statusMap: Record<string, EmisorStatus> = {
    VALIDATED: 'VALID',
    PENDING: 'PENDING',
    FAILED: 'INVALID',
    REVOKED: 'REVOKED',
  };
  return {
    id: row.id,
    cuit: row.cuit,
    alias: row.alias ?? null,
    razonSocial: row.razonSocial ?? null,
    condicionIva: row.condicionIva ?? null,
    puntoVenta: row.puntoVenta ?? null,
    certMode: row.certMode,
    status: statusMap[row.validationStatus] ?? 'PENDING',
    hasCertificate: row.certificateId !== null,
    certificateAlias: row.certificate?.alias ?? null,
    certificateExpiresAt: row.certificate?.notAfter ?? null,
    lastValidatedAt: row.validatedAt ?? null,
    invoicesThisPeriod: row.requestCount ?? 0,
    createdAt: row.createdAt,
  };
}
