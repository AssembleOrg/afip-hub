import { SetMetadata } from '@nestjs/common';
import { UsageKind } from '../../../generated/prisma';

export const BILLABLE_KEY = 'billable';

export interface BillableMetadata {
  kind: UsageKind;
  cost: number;
}

/**
 * Declara el tipo de uso del endpoint:
 *  - `BILLABLE` (default): descuenta 1 request de la quota del plan.
 *  - `PDF`: descuenta 1 request + aplica rate-limit propio (puppeteer es caro).
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
