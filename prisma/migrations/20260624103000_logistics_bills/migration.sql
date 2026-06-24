CREATE TABLE IF NOT EXISTS "logistics_bills" (
  "id" TEXT NOT NULL,
  "bill_key" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "supplier_id" TEXT,
  "bill_of_lading_no" TEXT NOT NULL DEFAULT '',
  "audit_status" TEXT NOT NULL DEFAULT '草稿',
  "invoice_status" TEXT NOT NULL DEFAULT '未通知',
  "payment_status" TEXT NOT NULL DEFAULT '待开票',
  "submitted_by" TEXT,
  "submitted_at" TIMESTAMP(3),
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_remark" TEXT,
  "reject_reason" TEXT,
  "invoice_notified_at" TIMESTAMP(3),
  "invoice_notification_error" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "logistics_bills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "logistics_bills_bill_key_key" ON "logistics_bills"("bill_key");
CREATE INDEX IF NOT EXISTS "logistics_bills_order_id_idx" ON "logistics_bills"("order_id");
CREATE INDEX IF NOT EXISTS "logistics_bills_supplier_id_idx" ON "logistics_bills"("supplier_id");
CREATE INDEX IF NOT EXISTS "logistics_bills_bill_of_lading_no_idx" ON "logistics_bills"("bill_of_lading_no");
CREATE INDEX IF NOT EXISTS "logistics_bills_audit_status_idx" ON "logistics_bills"("audit_status");
CREATE INDEX IF NOT EXISTS "logistics_bills_invoice_status_idx" ON "logistics_bills"("invoice_status");
CREATE INDEX IF NOT EXISTS "logistics_bills_payment_status_idx" ON "logistics_bills"("payment_status");
CREATE INDEX IF NOT EXISTS "logistics_bills_submitted_by_idx" ON "logistics_bills"("submitted_by");
CREATE INDEX IF NOT EXISTS "logistics_bills_reviewed_by_idx" ON "logistics_bills"("reviewed_by");
CREATE INDEX IF NOT EXISTS "logistics_bills_deleted_at_idx" ON "logistics_bills"("deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_bills_order_id_fkey') THEN
    ALTER TABLE "logistics_bills"
      ADD CONSTRAINT "logistics_bills_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_bills_supplier_id_fkey') THEN
    ALTER TABLE "logistics_bills"
      ADD CONSTRAINT "logistics_bills_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_bills_submitted_by_fkey') THEN
    ALTER TABLE "logistics_bills"
      ADD CONSTRAINT "logistics_bills_submitted_by_fkey"
      FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_bills_reviewed_by_fkey') THEN
    ALTER TABLE "logistics_bills"
      ADD CONSTRAINT "logistics_bills_reviewed_by_fkey"
      FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_bills_created_by_fkey') THEN
    ALTER TABLE "logistics_bills"
      ADD CONSTRAINT "logistics_bills_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_bills_updated_by_fkey') THEN
    ALTER TABLE "logistics_bills"
      ADD CONSTRAINT "logistics_bills_updated_by_fkey"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "logistics_expenses"
  ADD COLUMN IF NOT EXISTS "bill_id" TEXT;

CREATE INDEX IF NOT EXISTS "logistics_expenses_bill_id_idx" ON "logistics_expenses"("bill_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_bill_id_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_bill_id_fkey"
      FOREIGN KEY ("bill_id") REFERENCES "logistics_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

WITH expense_groups AS (
  SELECT
    le."order_id",
    COALESCE(NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl') AS "bill_of_lading_no",
    le."order_id" || '::' || LOWER(COALESCE(NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl')) AS "bill_key",
    CASE WHEN COUNT(DISTINCT le."supplier_id") = 1 THEN MIN(le."supplier_id") ELSE NULL END AS "supplier_id",
    CASE
      WHEN BOOL_OR(le."audit_status" = '审核通过') THEN '审核通过'
      WHEN BOOL_OR(le."audit_status" = '待审核') THEN '待审核'
      WHEN BOOL_OR(le."audit_status" = '已驳回') THEN '已驳回'
      ELSE '草稿'
    END AS "audit_status",
    CASE
      WHEN BOOL_AND(le."invoice_status" = '已确认') THEN '已确认'
      WHEN BOOL_AND(le."invoice_status" IN ('已上传', '已确认')) THEN '已上传发票'
      WHEN BOOL_OR(le."invoice_status" IN ('已上传', '已确认')) THEN '部分上传发票'
      WHEN BOOL_OR(le."invoice_status" = '通知失败') THEN '待开票 / 通知失败'
      WHEN BOOL_OR(le."invoice_status" = '已通知开票') THEN '已通知开票'
      ELSE '待开票'
    END AS "invoice_status",
    CASE
      WHEN BOOL_AND(le."payment_status" = '已付款') THEN '已付款'
      WHEN BOOL_OR(le."payment_status" = '已付款') THEN '部分付款'
      WHEN BOOL_OR(le."payment_status" IN ('待付款', '已开票')) THEN '待付款'
      ELSE '待开票'
    END AS "payment_status",
    MIN(le."created_by") AS "created_by",
    MIN(le."updated_by") AS "updated_by",
    MAX(le."submitted_at") AS "submitted_at",
    MAX(le."reviewed_by") AS "reviewed_by",
    MAX(le."reviewed_at") AS "reviewed_at",
    MAX(le."review_remark") AS "review_remark",
    MAX(le."reject_reason") AS "reject_reason",
    MAX(le."invoice_notified_at") AS "invoice_notified_at",
    MAX(le."invoice_notification_error") AS "invoice_notification_error",
    MIN(le."created_at") AS "created_at",
    MAX(le."updated_at") AS "updated_at"
  FROM "logistics_expenses" le
  JOIN "receivable_orders" ro ON ro."id" = le."order_id"
  WHERE le."deleted_at" IS NULL
  GROUP BY le."order_id", COALESCE(NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl')
)
INSERT INTO "logistics_bills" (
  "id",
  "bill_key",
  "order_id",
  "supplier_id",
  "bill_of_lading_no",
  "audit_status",
  "invoice_status",
  "payment_status",
  "submitted_at",
  "reviewed_by",
  "reviewed_at",
  "review_remark",
  "reject_reason",
  "invoice_notified_at",
  "invoice_notification_error",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at"
)
SELECT
  'bill_' || SUBSTRING(MD5("bill_key") FROM 1 FOR 24),
  "bill_key",
  "order_id",
  "supplier_id",
  "bill_of_lading_no",
  "audit_status",
  "invoice_status",
  "payment_status",
  "submitted_at",
  "reviewed_by",
  "reviewed_at",
  "review_remark",
  "reject_reason",
  "invoice_notified_at",
  "invoice_notification_error",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at"
FROM expense_groups
ON CONFLICT ("bill_key") DO UPDATE SET
  "audit_status" = EXCLUDED."audit_status",
  "invoice_status" = EXCLUDED."invoice_status",
  "payment_status" = EXCLUDED."payment_status",
  "updated_at" = EXCLUDED."updated_at";

UPDATE "logistics_expenses" le
SET "bill_id" = lb."id"
FROM "receivable_orders" ro, "logistics_bills" lb
WHERE ro."id" = le."order_id"
  AND lb."bill_key" = le."order_id" || '::' || LOWER(COALESCE(NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl'))
  AND (le."bill_id" IS NULL OR le."bill_id" <> lb."id");
