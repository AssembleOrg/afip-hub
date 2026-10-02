-- Cupo por comprobantes emitidos + cobro de excedente.

-- Las consultas a ARCA dejan de consumir cupo (solo rate-limit).
ALTER TYPE "UsageKind" ADD VALUE IF NOT EXISTS 'CONSULTA';

ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "consulta_rate_limit_per_min" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS "overage_price_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pdf_overage_price_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "overage_cap_factor" DECIMAL(5,2) NOT NULL DEFAULT 3;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "overage_usd" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "overage_comprobantes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "overage_pdfs" INTEGER NOT NULL DEFAULT 0;
