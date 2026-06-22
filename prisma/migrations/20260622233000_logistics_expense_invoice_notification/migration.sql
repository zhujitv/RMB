ALTER TABLE "logistics_expenses"
  ADD COLUMN IF NOT EXISTS "invoice_notified_at" TIMESTAMP(3);
