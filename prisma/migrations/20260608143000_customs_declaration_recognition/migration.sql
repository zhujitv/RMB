ALTER TABLE "receivable_orders"
  ADD COLUMN IF NOT EXISTS "customs_declaration_no" TEXT,
  ADD COLUMN IF NOT EXISTS "customs_declaration_date" DATE,
  ADD COLUMN IF NOT EXISTS "customs_export_date" DATE,
  ADD COLUMN IF NOT EXISTS "customs_port" TEXT,
  ADD COLUMN IF NOT EXISTS "customs_parsed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "customs_parse_status" TEXT,
  ADD COLUMN IF NOT EXISTS "customs_parse_message" TEXT;

CREATE INDEX IF NOT EXISTS "receivable_orders_customs_declaration_date_idx"
  ON "receivable_orders"("customs_declaration_date");

CREATE INDEX IF NOT EXISTS "receivable_orders_customs_export_date_idx"
  ON "receivable_orders"("customs_export_date");

CREATE INDEX IF NOT EXISTS "receivable_orders_customs_parse_status_idx"
  ON "receivable_orders"("customs_parse_status");
