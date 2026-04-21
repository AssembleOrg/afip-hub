-- CreateEnum
CREATE TYPE "RefreshTokenRevokeReason" AS ENUM ('LOGOUT', 'ROTATED', 'REUSE_DETECTED', 'EXPIRED', 'SECURITY_ACTION');

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "hashed_token" TEXT NOT NULL,
    "ancestor_id" TEXT NOT NULL,
    "parent_token_id" TEXT,
    "user_agent" TEXT,
    "ip_created" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "absolute_expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" "RefreshTokenRevokeReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "afip_ventanilla_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "emisor_id" TEXT NOT NULL,
    "afip_message_id" BIGINT NOT NULL,
    "sistema_publicador" INTEGER,
    "sistema_publicador_desc" TEXT,
    "asunto" TEXT NOT NULL,
    "fecha_publicacion" TIMESTAMP(3) NOT NULL,
    "fecha_vencimiento" TIMESTAMP(3),
    "prioridad" INTEGER,
    "tiene_adjunto" BOOLEAN NOT NULL DEFAULT false,
    "estado_afip" INTEGER NOT NULL,
    "body" TEXT,
    "body_fetched_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "read_by_user_id" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "afip_ventanilla_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_hashed_token_key" ON "refresh_tokens"("hashed_token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_ancestor_id_idx" ON "refresh_tokens"("ancestor_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "afip_ventanilla_messages_organization_id_read_at_idx" ON "afip_ventanilla_messages"("organization_id", "read_at");

-- CreateIndex
CREATE INDEX "afip_ventanilla_messages_organization_id_fecha_publicacion_idx" ON "afip_ventanilla_messages"("organization_id", "fecha_publicacion");

-- CreateIndex
CREATE INDEX "afip_ventanilla_messages_emisor_id_fecha_publicacion_idx" ON "afip_ventanilla_messages"("emisor_id", "fecha_publicacion");

-- CreateIndex
CREATE UNIQUE INDEX "afip_ventanilla_messages_emisor_id_afip_message_id_key" ON "afip_ventanilla_messages"("emisor_id", "afip_message_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "afip_ventanilla_messages" ADD CONSTRAINT "afip_ventanilla_messages_emisor_id_fkey" FOREIGN KEY ("emisor_id") REFERENCES "emisores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
