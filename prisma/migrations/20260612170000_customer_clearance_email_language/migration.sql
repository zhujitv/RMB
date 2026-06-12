ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "clearance_email_language" TEXT NOT NULL DEFAULT 'EN';
