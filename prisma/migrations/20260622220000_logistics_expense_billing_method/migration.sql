ALTER TABLE "logistics_expenses"
  ADD COLUMN IF NOT EXISTS "billing_method" TEXT,
  ADD COLUMN IF NOT EXISTS "billing_quantity" DECIMAL(18, 4);
