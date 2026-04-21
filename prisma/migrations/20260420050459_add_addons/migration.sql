-- CreateTable
CREATE TABLE "addons" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "channel" "PlanChannel" NOT NULL DEFAULT 'BOTH',
    "price_usd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "annual_price_usd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_addon_subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "addon_id" TEXT NOT NULL,
    "mp_preapproval_id" TEXT,
    "status" "SubscriptionStatus" NOT NULL,
    "billing_period" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "last_amount_ars" DECIMAL(14,2),
    "last_amount_usd" DECIMAL(10,2),
    "last_exchange_rate" DECIMAL(12,4),
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_addon_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_payments" (
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

    CONSTRAINT "addon_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "addons_slug_key" ON "addons"("slug");

-- CreateIndex
CREATE INDEX "addons_is_active_is_public_idx" ON "addons"("is_active", "is_public");

-- CreateIndex
CREATE UNIQUE INDEX "org_addon_subscriptions_mp_preapproval_id_key" ON "org_addon_subscriptions"("mp_preapproval_id");

-- CreateIndex
CREATE INDEX "org_addon_subscriptions_organization_id_idx" ON "org_addon_subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "org_addon_subscriptions_status_idx" ON "org_addon_subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "org_addon_subscriptions_organization_id_addon_id_key" ON "org_addon_subscriptions"("organization_id", "addon_id");

-- CreateIndex
CREATE UNIQUE INDEX "addon_payments_mp_payment_id_key" ON "addon_payments"("mp_payment_id");

-- CreateIndex
CREATE INDEX "addon_payments_subscription_id_created_at_idx" ON "addon_payments"("subscription_id", "created_at");

-- CreateIndex
CREATE INDEX "addon_payments_status_idx" ON "addon_payments"("status");

-- AddForeignKey
ALTER TABLE "org_addon_subscriptions" ADD CONSTRAINT "org_addon_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_addon_subscriptions" ADD CONSTRAINT "org_addon_subscriptions_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_payments" ADD CONSTRAINT "addon_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "org_addon_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
