ALTER TABLE "order_documents"
  ADD COLUMN IF NOT EXISTS "original_name" TEXT;

UPDATE "order_documents"
SET "original_name" = "file_name"
WHERE "original_name" IS NULL;
