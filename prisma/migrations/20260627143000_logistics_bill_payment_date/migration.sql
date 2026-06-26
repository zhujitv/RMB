ALTER TABLE "logistics_bills"
  ADD COLUMN IF NOT EXISTS "payment_date" DATE;

CREATE INDEX IF NOT EXISTS "logistics_bills_payment_date_idx"
  ON "logistics_bills" ("payment_date");
