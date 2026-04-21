-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'STORAGE_WARNING';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "archive_key" TEXT,
ADD COLUMN     "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "invoices_archived_at_idx" ON "invoices"("archived_at");
