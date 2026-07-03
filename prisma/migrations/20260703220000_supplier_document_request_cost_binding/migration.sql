ALTER TABLE "supplier_document_requests"
ADD COLUMN IF NOT EXISTS "cost_id" TEXT;

CREATE INDEX IF NOT EXISTS "supplier_document_requests_cost_id_idx"
  ON "supplier_document_requests"("cost_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_document_requests_cost_id_fkey'
  ) THEN
    ALTER TABLE "supplier_document_requests"
      ADD CONSTRAINT "supplier_document_requests_cost_id_fkey"
      FOREIGN KEY ("cost_id") REFERENCES "order_costs"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
