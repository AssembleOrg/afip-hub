-- CreateEnum
CREATE TYPE "PlanChannel" AS ENUM ('API', 'WEB');

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "channel" "PlanChannel" NOT NULL DEFAULT 'API',
ALTER COLUMN "cuit_limit" SET DEFAULT 2;
