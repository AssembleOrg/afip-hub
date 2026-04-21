-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'PAUSED');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('BILLABLE', 'PDF', 'TA', 'NON_BILLABLE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED', 'CANCELED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "platform_role" "PlatformRole",
    "organization_id" TEXT,
    "org_role" "OrgRole",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "mp_preapproval_id" TEXT,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "suspended_at" TIMESTAMP(3),
    "suspended_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_usd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "requests_limit" INTEGER NOT NULL,
    "cuit_limit" INTEGER NOT NULL DEFAULT 1,
    "pdf_rate_limit_per_min" INTEGER NOT NULL DEFAULT 60,
    "ta_rate_limit_per_min" INTEGER NOT NULL DEFAULT 10,
    "grace_factor" DECIMAL(4,3) NOT NULL DEFAULT 1.000,
    "features" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "mp_preapproval_id" TEXT,
    "status" "SubscriptionStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "last_amount_ars" DECIMAL(14,2),
    "last_amount_usd" DECIMAL(10,2),
    "last_exchange_rate" DECIMAL(12,4),
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "mp_payment_id" TEXT,
    "amount_ars" DECIMAL(14,2) NOT NULL,
    "amount_usd" DECIMAL(10,2) NOT NULL,
    "exchange_rate" DECIMAL(12,4) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hashed_key" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL DEFAULT 'BILLABLE',
    "cost" INTEGER NOT NULL DEFAULT 1,
    "status_code" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "billable_count" INTEGER NOT NULL DEFAULT 0,
    "pdf_count" INTEGER NOT NULL DEFAULT 0,
    "ta_count" INTEGER NOT NULL DEFAULT 0,
    "last_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "buy" DECIMAL(12,4) NOT NULL,
    "sell" DECIMAL(12,4) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_user_id" TEXT,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_platform_role_idx" ON "users"("platform_role");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_owner_user_id_key" ON "organizations"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_mp_preapproval_id_key" ON "organizations"("mp_preapproval_id");

-- CreateIndex
CREATE INDEX "organizations_plan_id_idx" ON "organizations"("plan_id");

-- CreateIndex
CREATE INDEX "organizations_subscription_status_idx" ON "organizations"("subscription_status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

-- CreateIndex
CREATE INDEX "plans_is_active_is_public_idx" ON "plans"("is_active", "is_public");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_mp_preapproval_id_key" ON "subscriptions"("mp_preapproval_id");

-- CreateIndex
CREATE INDEX "subscriptions_organization_id_idx" ON "subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_mp_payment_id_key" ON "payments"("mp_payment_id");

-- CreateIndex
CREATE INDEX "payments_subscription_id_created_at_idx" ON "payments"("subscription_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hashed_key_key" ON "api_keys"("hashed_key");

-- CreateIndex
CREATE INDEX "api_keys_organization_id_idx" ON "api_keys"("organization_id");

-- CreateIndex
CREATE INDEX "api_keys_hashed_key_idx" ON "api_keys"("hashed_key");

-- CreateIndex
CREATE INDEX "api_keys_revoked_at_idx" ON "api_keys"("revoked_at");

-- CreateIndex
CREATE INDEX "usage_events_organization_id_created_at_idx" ON "usage_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_organization_id_kind_created_at_idx" ON "usage_events"("organization_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_api_key_id_created_at_idx" ON "usage_events"("api_key_id", "created_at");

-- CreateIndex
CREATE INDEX "usage_events_created_at_idx" ON "usage_events"("created_at");

-- CreateIndex
CREATE INDEX "usage_counters_organization_id_idx" ON "usage_counters"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_counters_organization_id_period_start_key" ON "usage_counters"("organization_id", "period_start");

-- CreateIndex
CREATE INDEX "exchange_rates_source_fetched_at_idx" ON "exchange_rates"("source", "fetched_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
