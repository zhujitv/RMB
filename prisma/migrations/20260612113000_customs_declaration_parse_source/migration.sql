ALTER TABLE "receivable_orders"
  ADD COLUMN IF NOT EXISTS "customs_declaration_parse_source" TEXT;

CREATE INDEX IF NOT EXISTS "receivable_orders_customs_declaration_parse_source_idx"
  ON "receivable_orders"("customs_declaration_parse_source");
