CREATE TABLE "suppliers" (
  "id" TEXT NOT NULL,
  "supplier_name" TEXT NOT NULL,
  "supplier_type" TEXT NOT NULL DEFAULT '其他供应商',
  "country" TEXT,
  "contact_person" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "invoice_title" TEXT,
  "tax_number" TEXT,
  "bank_name" TEXT,
  "bank_account" TEXT,
  "remark" TEXT,
  "status" TEXT NOT NULL DEFAULT '启用',
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "suppliers_supplier_name_idx" ON "suppliers"("supplier_name");
CREATE INDEX "suppliers_supplier_type_idx" ON "suppliers"("supplier_type");
CREATE INDEX "suppliers_status_idx" ON "suppliers"("status");
CREATE INDEX "suppliers_deleted_at_idx" ON "suppliers"("deleted_at");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "receivable_orders" ALTER COLUMN "bl_no" DROP NOT NULL;
ALTER TABLE "receivable_orders" ADD COLUMN "estimated_receivable_amount" DECIMAL(18, 2);
ALTER TABLE "receivable_orders" ADD COLUMN "estimated_receivable_amount_cny" DECIMAL(18, 2);
ALTER TABLE "receivable_orders" ADD COLUMN "actual_shipment_amount" DECIMAL(18, 2);
ALTER TABLE "receivable_orders" ADD COLUMN "actual_shipment_amount_cny" DECIMAL(18, 2);
ALTER TABLE "receivable_orders" ADD COLUMN "final_receivable_amount" DECIMAL(18, 2);
ALTER TABLE "receivable_orders" ADD COLUMN "final_receivable_amount_cny" DECIMAL(18, 2);

UPDATE "receivable_orders"
SET
  "estimated_receivable_amount" = "receivable_amount",
  "estimated_receivable_amount_cny" = "receivable_amount_cny",
  "final_receivable_amount" = "receivable_amount",
  "final_receivable_amount_cny" = "receivable_amount_cny";

UPDATE "receivable_orders" SET "status" = '已确认' WHERE "status" = '已提交';
UPDATE "receivable_orders" SET "status" = '已确认' WHERE "status" = '已逾期';

ALTER TABLE "receivable_orders" ALTER COLUMN "estimated_receivable_amount" SET NOT NULL;
ALTER TABLE "receivable_orders" ALTER COLUMN "estimated_receivable_amount_cny" SET NOT NULL;
ALTER TABLE "receivable_orders" ALTER COLUMN "final_receivable_amount" SET NOT NULL;
ALTER TABLE "receivable_orders" ALTER COLUMN "final_receivable_amount_cny" SET NOT NULL;

ALTER TABLE "payments" ADD COLUMN "payment_type" TEXT NOT NULL DEFAULT '尾款';

ALTER TABLE "order_costs" ADD COLUMN "supplier_id" TEXT;
ALTER TABLE "order_costs" ADD COLUMN "supplier_name_snapshot" TEXT;
UPDATE "order_costs" SET "supplier_name_snapshot" = COALESCE(NULLIF(TRIM("vendor_name"), ''), '未关联供应商');

INSERT INTO "suppliers" ("id", "supplier_name", "supplier_type", "status", "created_at", "updated_at")
SELECT
  'legacy-supplier-' || md5(TRIM("vendor_name")),
  TRIM("vendor_name"),
  '其他供应商',
  '启用',
  MIN("created_at"),
  CURRENT_TIMESTAMP
FROM "order_costs"
WHERE NULLIF(TRIM("vendor_name"), '') IS NOT NULL
GROUP BY TRIM("vendor_name")
ON CONFLICT ("id") DO NOTHING;

UPDATE "order_costs"
SET "supplier_id" = 'legacy-supplier-' || md5(TRIM("vendor_name"))
WHERE NULLIF(TRIM("vendor_name"), '') IS NOT NULL;

ALTER TABLE "order_costs" ALTER COLUMN "supplier_name_snapshot" SET NOT NULL;
ALTER TABLE "order_costs" ALTER COLUMN "supplier_name_snapshot" SET DEFAULT '';
CREATE INDEX "order_costs_supplier_id_idx" ON "order_costs"("supplier_id");
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
