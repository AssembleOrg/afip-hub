-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "related_to_invoice_id" TEXT;

-- CreateIndex
CREATE INDEX "invoices_related_to_invoice_id_idx" ON "invoices"("related_to_invoice_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_related_to_invoice_id_fkey" FOREIGN KEY ("related_to_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
