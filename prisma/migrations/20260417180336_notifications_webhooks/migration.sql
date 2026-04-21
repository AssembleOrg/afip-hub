-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('VERIFY_EMAIL', 'PASSWORD_RESET', 'QUOTA_WARNING_80', 'QUOTA_EXHAUSTED_100', 'PAYMENT_FAILED', 'PAYMENT_APPROVED', 'SUBSCRIPTION_ACTIVATED', 'SUBSCRIPTION_CANCELED', 'BLUE_JUMPED', 'CERTIFICATE_EXPIRING');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "user_id" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "dedupe_key" TEXT,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "description" TEXT,
    "secret_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_success_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL,
    "last_attempt_at" TIMESTAMP(3),
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_dedupe_key_key" ON "notification_deliveries"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_organization_id_created_at_idx" ON "notification_deliveries"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_kind_created_at_idx" ON "notification_deliveries"("kind", "created_at");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_organization_id_is_active_idx" ON "webhook_subscriptions"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_subscription_id_created_at_idx" ON "webhook_deliveries"("subscription_id", "created_at");

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
