ALTER TABLE "order_documents"
  ADD COLUMN IF NOT EXISTS "original_filename" TEXT,
  ADD COLUMN IF NOT EXISTS "standard_filename" TEXT;

CREATE INDEX IF NOT EXISTS "order_documents_standard_filename_idx" ON "order_documents"("standard_filename");
