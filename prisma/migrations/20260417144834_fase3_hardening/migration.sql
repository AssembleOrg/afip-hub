-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "org_cuits" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "alias" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "org_cuits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "ip_requested" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_cuits_organization_id_idx" ON "org_cuits"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_cuits_organization_id_cuit_key" ON "org_cuits"("organization_id", "cuit");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_organization_id_key_key" ON "idempotency_keys"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "org_cuits" ADD CONSTRAINT "org_cuits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
