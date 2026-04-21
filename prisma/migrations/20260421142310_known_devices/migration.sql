-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'NEW_DEVICE';

-- CreateTable
CREATE TABLE "known_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "fingerprint_hash" TEXT NOT NULL,
    "label" TEXT,
    "last_ip" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "known_devices_user_id_idx" ON "known_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "known_devices_user_id_fingerprint_hash_key" ON "known_devices"("user_id", "fingerprint_hash");

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
