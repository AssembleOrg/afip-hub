-- CreateEnum
CREATE TYPE "EmisorCertMode" AS ENUM ('ACCOUNT', 'PLATFORM');

-- AlterTable
ALTER TABLE "emisores" ADD COLUMN     "cert_mode" "EmisorCertMode" NOT NULL DEFAULT 'ACCOUNT';
