-- LogisticsBill is the only workflow-state source for logistics expense bills.
-- This migration only backfills missing bill records/links for historical rows.
-- It intentionally does not sync LogisticsBill status back to detail rows.

WITH missing_expense_groups AS (
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
    AND le."bill_id" IS NULL
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
FROM missing_expense_groups
ON CONFLICT ("bill_key") DO NOTHING;

UPDATE "logistics_expenses" le
SET "bill_id" = lb."id"
FROM "receivable_orders" ro, "logistics_bills" lb
WHERE ro."id" = le."order_id"
  AND le."bill_id" IS NULL
  AND lb."bill_key" = le."order_id" || '::' || LOWER(COALESCE(NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl'));
