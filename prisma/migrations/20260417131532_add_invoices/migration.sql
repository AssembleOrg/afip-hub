-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "cuit_emisor" TEXT NOT NULL,
    "punto_venta" INTEGER NOT NULL,
    "tipo_comprobante" INTEGER NOT NULL,
    "numero_comprobante" BIGINT NOT NULL,
    "fecha_comprobante" DATE NOT NULL,
    "cae" TEXT NOT NULL,
    "cae_vencimiento" DATE NOT NULL,
    "receptor_tipo_doc" INTEGER,
    "receptor_nro_doc" TEXT,
    "receptor_nombre" TEXT,
    "condicion_iva_receptor" INTEGER,
    "moneda" TEXT NOT NULL DEFAULT 'PES',
    "cotizacion" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "importe_neto" DECIMAL(14,2) NOT NULL,
    "importe_iva" DECIMAL(14,2) NOT NULL,
    "importe_tributos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importe_total" DECIMAL(14,2) NOT NULL,
    "homologacion" BOOLEAN NOT NULL DEFAULT false,
    "raw_request" JSONB,
    "raw_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_organization_id_created_at_idx" ON "invoices"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "invoices_organization_id_cuit_emisor_idx" ON "invoices"("organization_id", "cuit_emisor");

-- CreateIndex
CREATE INDEX "invoices_organization_id_fecha_comprobante_idx" ON "invoices"("organization_id", "fecha_comprobante");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_cuit_emisor_punto_venta_tipo_comprobante_numero_co_key" ON "invoices"("cuit_emisor", "punto_venta", "tipo_comprobante", "numero_comprobante", "homologacion");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
