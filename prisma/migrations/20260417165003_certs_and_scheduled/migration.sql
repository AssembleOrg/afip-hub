-- CreateEnum
CREATE TYPE "ScheduledTaskType" AS ENUM ('INVOICE', 'CONSULTAR_CUIT', 'ULTIMO_AUTORIZADO');

-- CreateEnum
CREATE TYPE "ScheduledTaskRunStatus" AS ENUM ('RUNNING', 'OK', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "vault_path" TEXT NOT NULL,
    "not_before" TIMESTAMP(3) NOT NULL,
    "not_after" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "last_used_by_task_id" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "certificate_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ScheduledTaskType" NOT NULL,
    "cron_expression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "run_once" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "last_run_status" "ScheduledTaskRunStatus",
    "next_run_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_task_runs" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "status" "ScheduledTaskRunStatus" NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "duration_ms" INTEGER,

    CONSTRAINT "scheduled_task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "certificates_organization_id_is_active_idx" ON "certificates"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "certificates_not_after_idx" ON "certificates"("not_after");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_organization_id_fingerprint_key" ON "certificates"("organization_id", "fingerprint");

-- CreateIndex
CREATE INDEX "scheduled_tasks_organization_id_is_active_idx" ON "scheduled_tasks"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "scheduled_tasks_next_run_at_is_active_idx" ON "scheduled_tasks"("next_run_at", "is_active");

-- CreateIndex
CREATE INDEX "scheduled_tasks_certificate_id_idx" ON "scheduled_tasks"("certificate_id");

-- CreateIndex
CREATE INDEX "scheduled_task_runs_task_id_started_at_idx" ON "scheduled_task_runs"("task_id", "started_at");

-- CreateIndex
CREATE INDEX "scheduled_task_runs_status_started_at_idx" ON "scheduled_task_runs"("status", "started_at");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
