ALTER TABLE "certificates"
ADD COLUMN "encrypted_payload" TEXT,
ADD COLUMN "encryption_iv" TEXT,
ADD COLUMN "encryption_tag" TEXT,
ADD COLUMN "encryption_key_version" INTEGER NOT NULL DEFAULT 1;
