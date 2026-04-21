-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('USER', 'API_KEY', 'SYSTEM', 'PLATFORM_ADMIN');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_type" "AuditActor" NOT NULL,
    "actor_user_id" TEXT,
    "actor_api_key_id" TEXT,
    "actor_label" TEXT,
    "organization_id" TEXT,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB,
    "changes" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
