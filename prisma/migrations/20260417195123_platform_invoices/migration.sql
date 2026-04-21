-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('PENDING', 'EMITTED', 'FAILED', 'SKIPPED', 'ABANDONED');

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "error" TEXT,
    "cae" TEXT,
    "cae_vencimiento" DATE,
    "punto_venta" INTEGER,
    "tipo_comprobante" INTEGER,
    "numero_comprobante" BIGINT,
    "fecha_comprobante" DATE,
    "cuit_emisor" TEXT,
    "cuit_receptor" TEXT,
    "homologacion" BOOLEAN NOT NULL DEFAULT false,
    "emitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_payment_id_key" ON "platform_invoices"("payment_id");

-- CreateIndex
CREATE INDEX "platform_invoices_status_last_attempt_at_idx" ON "platform_invoices"("status", "last_attempt_at");

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
