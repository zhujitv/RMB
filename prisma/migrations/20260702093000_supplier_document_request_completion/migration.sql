ALTER TABLE "supplier_document_requests"
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_by" TEXT;

UPDATE "supplier_document_requests"
SET "completed_at" = COALESCE("sent_at", "updated_at")
WHERE "status" = '已完成'
  AND "completed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "supplier_document_requests_completed_by_idx"
  ON "supplier_document_requests"("completed_by");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_document_requests_completed_by_fkey'
  ) THEN
    ALTER TABLE "supplier_document_requests"
      ADD CONSTRAINT "supplier_document_requests_completed_by_fkey"
      FOREIGN KEY ("completed_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
