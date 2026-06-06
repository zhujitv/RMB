ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "avatar_initials" TEXT,
  ADD COLUMN IF NOT EXISTS "default_language" TEXT;
