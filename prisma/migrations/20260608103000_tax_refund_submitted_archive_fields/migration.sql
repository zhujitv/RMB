ALTER TABLE "receivable_orders"
ADD COLUMN IF NOT EXISTS "tax_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "tax_submitted_by" TEXT,
ADD COLUMN IF NOT EXISTS "tax_submitted_at" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "receivable_orders"
    ADD CONSTRAINT "receivable_orders_tax_submitted_by_fkey"
    FOREIGN KEY ("tax_submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

UPDATE "receivable_orders"
SET
  "tax_refund_status" = CASE
    WHEN "tax_refund_status" IN ('COMPLETED', 'ARCHIVED') THEN 'SUBMITTED'
    ELSE "tax_refund_status"
  END,
  "tax_archived" = true,
  "tax_refund_archived_at" = COALESCE("tax_refund_archived_at", "updated_at", now()),
  "tax_submitted_at" = COALESCE("tax_submitted_at", "tax_refund_archived_at", "updated_at", now()),
  "tax_submitted_by" = COALESCE("tax_submitted_by", "tax_refund_archived_by")
WHERE
  "tax_refund_status" IN ('SUBMITTED', 'COMPLETED', 'ARCHIVED')
  OR "tax_refund_archived_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "receivable_orders_tax_archived_idx" ON "receivable_orders"("tax_archived");
CREATE INDEX IF NOT EXISTS "receivable_orders_tax_submitted_at_idx" ON "receivable_orders"("tax_submitted_at");
CREATE INDEX IF NOT EXISTS "receivable_orders_tax_submitted_by_idx" ON "receivable_orders"("tax_submitted_by");
