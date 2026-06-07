ALTER TABLE "domestic_logistics_infos"
ADD COLUMN IF NOT EXISTS "temporary_supplier_name" TEXT,
ADD COLUMN IF NOT EXISTS "submitter_role" TEXT,
ADD COLUMN IF NOT EXISTS "unlocked_by_user_id" TEXT,
ADD COLUMN IF NOT EXISTS "unlocked_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_deleted_at_idx" ON "domestic_logistics_infos"("deleted_at");
CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_submitter_role_idx" ON "domestic_logistics_infos"("submitter_role");
