-- AlterTable
ALTER TABLE "addons" ADD COLUMN     "allow_proration" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "pdf_limit" INTEGER NOT NULL DEFAULT 20;
