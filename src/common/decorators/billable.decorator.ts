import { SetMetadata } from '@nestjs/common';
import { UsageKind } from '../../../generated/prisma';

export const BILLABLE_KEY = 'billable';

export interface BillableMetadata {
  kind: UsageKind;
  cost: number;
}

/**
 * Declara el tipo de uso del endpoint:
 *  - `BILLABLE` (default): emite un comprobante; descuenta 1 del cupo de
 *    comprobantes del plan (solo si ARCA lo aprueba).
 *  - `PDF`: descuenta 1 del cupo de PDFs + rate-limit propio (puppeteer es caro).
 *  - `CONSULTA`: consulta a ARCA; NO cuenta para el cupo, solo rate-limit.
 *  - `TA`: NO cuenta para quota, pero aplica rate-limit anti-abuso.
 *  - `NON_BILLABLE`: gratis, sin rate-limit.
 *
 * Endpoints sin este decorador se consideran `NON_BILLABLE` (admin, health, etc.).
 */
export const Billable = (meta: Partial<BillableMetadata> = {}) =>
  SetMetadata(BILLABLE_KEY, {
    kind: meta.kind ?? UsageKind.BILLABLE,
    cost: meta.cost ?? 1,
  } satisfies BillableMetadata);

export const PdfBillable = () => Billable({ kind: UsageKind.PDF });
export const TaBillable = () => Billable({ kind: UsageKind.TA });
export const ConsultaBillable = () => Billable({ kind: UsageKind.CONSULTA });
