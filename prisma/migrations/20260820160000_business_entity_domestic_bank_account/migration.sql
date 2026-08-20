ALTER TABLE "business_entities"
  ADD COLUMN IF NOT EXISTS "domestic_bank_name" TEXT,
  ADD COLUMN IF NOT EXISTS "domestic_bank_account" TEXT;
