-- Comprobantes de regalo por ciclo (compensación por fallas de nuestro lado).
ALTER TABLE "usage_counters"
  ADD COLUMN IF NOT EXISTS "bonus_count" INTEGER NOT NULL DEFAULT 0;
