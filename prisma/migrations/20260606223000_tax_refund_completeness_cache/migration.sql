ALTER TABLE "receivable_orders"
ADD COLUMN IF NOT EXISTS "tax_refund_completeness" JSONB,
ADD COLUMN IF NOT EXISTS "tax_refund_completeness_updated_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "receivable_orders_tax_refund_completeness_updated_at_idx"
ON "receivable_orders" ("tax_refund_completeness_updated_at");
