UPDATE "logistics_expenses" le
SET
  "audit_status" = lb."audit_status",
  "reviewed_by" = COALESCE(le."reviewed_by", lb."reviewed_by"),
  "reviewed_at" = COALESCE(le."reviewed_at", lb."reviewed_at"),
  "review_remark" = COALESCE(le."review_remark", lb."review_remark"),
  "reject_reason" = CASE
    WHEN lb."audit_status" = '审核通过' THEN NULL
    ELSE COALESCE(le."reject_reason", lb."reject_reason")
  END
FROM "logistics_bills" lb
WHERE le."bill_id" = lb."id"
  AND le."deleted_at" IS NULL
  AND lb."deleted_at" IS NULL
  AND lb."audit_status" IN ('草稿', '待审核', '审核通过', '已驳回')
  AND le."audit_status" IS DISTINCT FROM lb."audit_status";
