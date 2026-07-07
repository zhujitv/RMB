ALTER TABLE "logistics_bills"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS "voided_by" TEXT,
  ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "void_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "void_remark" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'logistics_bills_voided_by_fkey'
  ) THEN
    ALTER TABLE "logistics_bills"
      ADD CONSTRAINT "logistics_bills_voided_by_fkey"
      FOREIGN KEY ("voided_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "logistics_bills_status_idx" ON "logistics_bills"("status");
CREATE INDEX IF NOT EXISTS "logistics_bills_voided_at_idx" ON "logistics_bills"("voided_at");
CREATE INDEX IF NOT EXISTS "logistics_bills_voided_by_idx" ON "logistics_bills"("voided_by");
CREATE INDEX IF NOT EXISTS "logistics_bills_void_status_idx" ON "logistics_bills"("deleted_at", "status", "updated_at");
