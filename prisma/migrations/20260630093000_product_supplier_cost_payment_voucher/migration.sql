ALTER TABLE "order_costs" ADD COLUMN IF NOT EXISTS "paid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "order_costs" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3);
ALTER TABLE "order_costs" ADD COLUMN IF NOT EXISTS "payment_voucher_url" TEXT;
ALTER TABLE "order_costs" ADD COLUMN IF NOT EXISTS "payment_voucher_file_name" TEXT;
ALTER TABLE "order_costs" ADD COLUMN IF NOT EXISTS "payment_voucher_mime_type" TEXT;
ALTER TABLE "order_costs" ADD COLUMN IF NOT EXISTS "payment_voucher_uploaded_at" TIMESTAMP(3);
ALTER TABLE "order_costs" ADD COLUMN IF NOT EXISTS "payment_voucher_storage_key" TEXT;
ALTER TABLE "order_costs" ADD COLUMN IF NOT EXISTS "payment_voucher_bucket" TEXT;

UPDATE "order_costs"
SET "paid" = true,
    "paid_at" = COALESCE("paid_at", "payment_date", "updated_at")
WHERE "deleted_at" IS NULL
  AND "source_type" <> 'LOGISTICS_EXPENSE'
  AND "cost_type" IN ('工厂货款', '原材料货款', '采购货款', '产品货款')
  AND "payment_status" IN ('已支付', '部分支付')
  AND "paid" = false;

UPDATE "order_costs"
SET "paid_at" = NULL
WHERE "paid" = false;

CREATE INDEX IF NOT EXISTS "order_costs_paid_idx" ON "order_costs"("paid");
CREATE INDEX IF NOT EXISTS "order_costs_paid_at_idx" ON "order_costs"("paid_at");
