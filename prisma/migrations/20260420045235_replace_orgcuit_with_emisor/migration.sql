/*
  Warnings:

  - You are about to drop the `org_cuits` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "EmisorValidationStatus" AS ENUM ('PENDING', 'VALIDATED', 'FAILED');

-- DropForeignKey
ALTER TABLE "org_cuits" DROP CONSTRAINT "org_cuits_organization_id_fkey";

-- DropTable
DROP TABLE "org_cuits";

-- CreateTable
CREATE TABLE "emisores" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "razon_social" TEXT,
    "alias" TEXT,
    "certificate_id" TEXT,
    "validation_status" "EmisorValidationStatus" NOT NULL DEFAULT 'PENDING',
    "validated_at" TIMESTAMP(3),
    "validation_error" TEXT,
    "validation_error_code" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "emisores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emisores_organization_id_deleted_at_idx" ON "emisores"("organization_id", "deleted_at");

-- CreateIndex
CREATE INDEX "emisores_certificate_id_idx" ON "emisores"("certificate_id");

-- CreateIndex
CREATE UNIQUE INDEX "emisores_organization_id_cuit_key" ON "emisores"("organization_id", "cuit");

-- AddForeignKey
ALTER TABLE "emisores" ADD CONSTRAINT "emisores_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emisores" ADD CONSTRAINT "emisores_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
