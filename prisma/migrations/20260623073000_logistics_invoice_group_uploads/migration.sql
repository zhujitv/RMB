ALTER TABLE "logistics_expenses"
  ADD COLUMN IF NOT EXISTS "invoice_notification_error" TEXT;

DROP INDEX IF EXISTS "logistics_expenses_invoice_document_id_key";

CREATE INDEX IF NOT EXISTS "logistics_expenses_invoice_document_id_idx"
  ON "logistics_expenses"("invoice_document_id");

