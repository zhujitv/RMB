ALTER TABLE "receivable_orders"
  ADD COLUMN IF NOT EXISTS "tax_refund_overall_completeness" INTEGER,
  ADD COLUMN IF NOT EXISTS "tax_refund_completeness_issues_summary" TEXT;

CREATE INDEX IF NOT EXISTS "receivable_orders_tax_refund_overall_completeness_idx"
  ON "receivable_orders"("tax_refund_overall_completeness");

CREATE INDEX IF NOT EXISTS "receivable_orders_tax_list_light_idx"
  ON "receivable_orders"("deleted_at", "tax_archived", "tax_refund_status", "tax_refund_overall_completeness", "customs_declaration_date", "updated_at");

CREATE INDEX IF NOT EXISTS "receivable_orders_customer_name_snapshot_idx"
  ON "receivable_orders"("customer_name_snapshot");
