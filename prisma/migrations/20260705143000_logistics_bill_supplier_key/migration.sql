-- Logistics bills must be isolated by supplier. Historical bills were keyed by
-- order + Master B/L only, which can mix multiple logistics suppliers under the
-- same bill. Backfill supplier-scoped bills and relink active expense rows.

WITH supplier_expense_groups AS (
  SELECT
    le."order_id",
    le."supplier_id",
    COALESCE(NULLIF(TRIM(lb."bill_of_lading_no"), ''), NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl') AS "bill_of_lading_no",
    le."order_id" || '::' || LOWER(COALESCE(NULLIF(TRIM(lb."bill_of_lading_no"), ''), NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl')) || '::' || le."supplier_id" AS "bill_key",
    CASE
      WHEN BOOL_OR(COALESCE(lb."audit_status", le."audit_status") = '审核通过') THEN '审核通过'
      WHEN BOOL_OR(COALESCE(lb."audit_status", le."audit_status") = '待审核') THEN '待审核'
      WHEN BOOL_OR(COALESCE(lb."audit_status", le."audit_status") = '已驳回') THEN '已驳回'
      ELSE '草稿'
    END AS "audit_status",
    CASE
      WHEN BOOL_AND(COALESCE(lb."invoice_status", le."invoice_status") IN ('已确认', '已确认发票')) THEN '已确认'
      WHEN BOOL_AND(COALESCE(lb."invoice_status", le."invoice_status") IN ('已上传', '已上传发票', '已确认', '已确认发票')) THEN '已上传发票'
      WHEN BOOL_OR(COALESCE(lb."invoice_status", le."invoice_status") IN ('已上传', '已上传发票', '已确认', '已确认发票')) THEN '部分上传发票'
      WHEN BOOL_OR(COALESCE(lb."invoice_status", le."invoice_status") = '通知失败') THEN '待开票 / 通知失败'
      WHEN BOOL_OR(COALESCE(lb."invoice_status", le."invoice_status") = '已通知开票') THEN '已通知开票'
      ELSE '待开票'
    END AS "invoice_status",
    CASE
      WHEN BOOL_AND(COALESCE(lb."payment_status", le."payment_status") = '已付款') THEN '已付款'
      WHEN BOOL_OR(COALESCE(lb."payment_status", le."payment_status") = '已付款') THEN '部分付款'
      WHEN BOOL_OR(COALESCE(lb."payment_status", le."payment_status") IN ('待付款', '已开票')) THEN '待付款'
      ELSE '待开票'
    END AS "payment_status",
    MAX(lb."submitted_by") AS "submitted_by",
    MAX(COALESCE(lb."submitted_at", le."submitted_at")) AS "submitted_at",
    MAX(COALESCE(lb."reviewed_by", le."reviewed_by")) AS "reviewed_by",
    MAX(COALESCE(lb."reviewed_at", le."reviewed_at")) AS "reviewed_at",
    MAX(COALESCE(lb."review_remark", le."review_remark")) AS "review_remark",
    MAX(COALESCE(lb."reject_reason", le."reject_reason")) AS "reject_reason",
    MAX(COALESCE(lb."invoice_notified_at", le."invoice_notified_at")) AS "invoice_notified_at",
    MAX(COALESCE(lb."invoice_notification_error", le."invoice_notification_error")) AS "invoice_notification_error",
    MAX(lb."payment_date") AS "payment_date",
    MIN(COALESCE(lb."created_by", le."created_by")) AS "created_by",
    MAX(COALESCE(lb."updated_by", le."updated_by")) AS "updated_by",
    MIN(COALESCE(lb."created_at", le."created_at")) AS "created_at",
    MAX(COALESCE(lb."updated_at", le."updated_at")) AS "updated_at"
  FROM "logistics_expenses" le
  JOIN "receivable_orders" ro ON ro."id" = le."order_id"
  LEFT JOIN "logistics_bills" lb ON lb."id" = le."bill_id"
  WHERE le."deleted_at" IS NULL
    AND le."supplier_id" IS NOT NULL
  GROUP BY
    le."order_id",
    le."supplier_id",
    COALESCE(NULLIF(TRIM(lb."bill_of_lading_no"), ''), NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl')
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
  "submitted_by",
  "submitted_at",
  "reviewed_by",
  "reviewed_at",
  "review_remark",
  "reject_reason",
  "invoice_notified_at",
  "invoice_notification_error",
  "payment_date",
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
  "submitted_by",
  "submitted_at",
  "reviewed_by",
  "reviewed_at",
  "review_remark",
  "reject_reason",
  "invoice_notified_at",
  "invoice_notification_error",
  "payment_date",
  "created_by",
  "updated_by",
  "created_at",
  "updated_at"
FROM supplier_expense_groups
ON CONFLICT ("bill_key") DO UPDATE SET
  "supplier_id" = EXCLUDED."supplier_id",
  "bill_of_lading_no" = EXCLUDED."bill_of_lading_no",
  "deleted_at" = NULL,
  "updated_at" = GREATEST("logistics_bills"."updated_at", EXCLUDED."updated_at");

UPDATE "logistics_expenses" le
SET "bill_id" = lb."id"
FROM "receivable_orders" ro, "logistics_bills" lb
WHERE ro."id" = le."order_id"
  AND le."deleted_at" IS NULL
  AND le."supplier_id" IS NOT NULL
  AND lb."bill_key" = le."order_id" || '::' || LOWER(COALESCE(NULLIF(TRIM(lb."bill_of_lading_no"), ''), NULLIF(TRIM(ro."bl_no"), ''), NULLIF(TRIM(ro."order_no"), ''), 'no-bl')) || '::' || le."supplier_id"
  AND (le."bill_id" IS NULL OR le."bill_id" <> lb."id");

UPDATE "logistics_bills" lb
SET "deleted_at" = COALESCE(lb."deleted_at", NOW())
WHERE lb."deleted_at" IS NULL
  AND ARRAY_LENGTH(STRING_TO_ARRAY(lb."bill_key", '::'), 1) < 3
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_expenses" le
    WHERE le."bill_id" = lb."id"
      AND le."deleted_at" IS NULL
  );
