ALTER TABLE "receivable_orders"
ADD COLUMN IF NOT EXISTS "tax_refund_archived_by" TEXT,
ADD COLUMN IF NOT EXISTS "tax_refund_archived_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "tax_refund_archive_remark" TEXT;

DO $$ BEGIN
  ALTER TABLE "receivable_orders"
    ADD CONSTRAINT "receivable_orders_tax_refund_archived_by_fkey"
    FOREIGN KEY ("tax_refund_archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "receivable_orders_tax_refund_archived_at_idx" ON "receivable_orders"("tax_refund_archived_at");
CREATE INDEX IF NOT EXISTS "receivable_orders_tax_refund_archived_by_idx" ON "receivable_orders"("tax_refund_archived_by");
