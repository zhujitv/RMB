ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "approval_status" TEXT NOT NULL DEFAULT 'APPROVED';

UPDATE "users"
SET "approval_status" = CASE
  WHEN "is_active" = true THEN 'APPROVED'
  ELSE 'DISABLED'
END
WHERE "approval_status" IS NULL OR "approval_status" = 'APPROVED';

CREATE INDEX IF NOT EXISTS "users_approval_status_idx" ON "users"("approval_status");
