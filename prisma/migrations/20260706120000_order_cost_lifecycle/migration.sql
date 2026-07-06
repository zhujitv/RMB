ALTER TABLE "order_costs"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "voided_by" TEXT,
  ADD COLUMN IF NOT EXISTS "void_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "restored_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "restored_by" TEXT,
  ADD COLUMN IF NOT EXISTS "restore_reason" TEXT;

UPDATE "order_costs"
SET
  "status" = 'VOID',
  "voided_at" = COALESCE("deleted_at", "updated_at"),
  "void_reason" = COALESCE("void_reason", '历史已取消成本迁移为作废')
WHERE "deleted_at" IS NULL
  AND "payment_status" = '已取消'
  AND COALESCE("status", 'ACTIVE') <> 'VOID';

CREATE INDEX IF NOT EXISTS "order_costs_status_idx" ON "order_costs"("status");
CREATE INDEX IF NOT EXISTS "order_costs_voided_at_idx" ON "order_costs"("voided_at");
