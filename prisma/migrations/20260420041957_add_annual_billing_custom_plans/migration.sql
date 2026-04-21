-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- AlterEnum
ALTER TYPE "PlanChannel" ADD VALUE 'BOTH';

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "annual_price_usd" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "is_custom" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billing_period" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY';
