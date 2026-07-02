ALTER TABLE "supplier_document_requests"
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT;

CREATE INDEX IF NOT EXISTS "supplier_document_requests_deleted_by_idx"
  ON "supplier_document_requests"("deleted_by");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_document_requests_deleted_by_fkey'
  ) THEN
    ALTER TABLE "supplier_document_requests"
      ADD CONSTRAINT "supplier_document_requests_deleted_by_fkey"
      FOREIGN KEY ("deleted_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
