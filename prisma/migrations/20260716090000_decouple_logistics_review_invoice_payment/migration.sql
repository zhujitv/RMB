BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

-- Notification delivery is tracked by invoice_notified_at / invoice_notification_error,
-- not by the invoice workflow status.
UPDATE "logistics_expenses"
SET "invoice_status" = '待开票'
WHERE "invoice_status" IN ('未通知', '已通知开票', '通知失败', '待开票 / 通知失败')
  AND "deleted_at" IS NULL
  AND "payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND NOT EXISTS (
    SELECT 1
    FROM "order_costs" AS cost
    WHERE (
        cost."id" = "logistics_expenses"."cost_id"
        OR (
          cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
          AND cost."source_id" = "logistics_expenses"."id"
        )
      )
      AND (
        cost."paid" = TRUE
        OR cost."payment_status" IN ('已支付', '部分支付', '已付款', '部分付款')
        OR cost."paid_at" IS NOT NULL
        OR cost."payment_date" IS NOT NULL
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_bills" AS bill
    WHERE bill."id" = "logistics_expenses"."bill_id"
      AND (
        bill."status" = 'voided'
        OR bill."payment_status" IN ('已付款', '部分付款', '部分已付款')
      )
  );

-- Backfill a missing bill supplier only when every active detail row has the
-- same supplier and already belongs to the bill order.
WITH unambiguous_bill_scope AS (
  SELECT
    expense."bill_id",
    MIN(expense."supplier_id") AS "supplier_id"
  FROM "logistics_expenses" AS expense
  INNER JOIN "logistics_bills" AS bill ON bill."id" = expense."bill_id"
  WHERE expense."deleted_at" IS NULL
    AND expense."bill_id" IS NOT NULL
    AND expense."supplier_id" IS NOT NULL
  GROUP BY expense."bill_id", bill."order_id"
  HAVING COUNT(DISTINCT expense."supplier_id") = 1
    AND COUNT(*) FILTER (WHERE expense."order_id" IS DISTINCT FROM bill."order_id") = 0
)
UPDATE "logistics_bills" AS bill
SET "supplier_id" = scope."supplier_id"
FROM unambiguous_bill_scope AS scope
WHERE bill."id" = scope."bill_id"
  AND bill."supplier_id" IS NULL;

-- Repair unambiguous legacy logistics cost links, then detach any remaining
-- active/unpaid link that points at another source, order, or supplier. The
-- original cost row is preserved for audit and is never overwritten here.
WITH repairable_cost_links AS (
  SELECT expense."id" AS "expense_id", cost."id" AS "cost_id"
  FROM "logistics_expenses" AS expense
  INNER JOIN "logistics_bills" AS bill ON bill."id" = expense."bill_id"
  INNER JOIN "order_costs" AS cost ON cost."id" = expense."cost_id"
  WHERE expense."deleted_at" IS NULL
    AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
    AND bill."deleted_at" IS NULL
    AND bill."status" <> 'voided'
    AND bill."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
    AND cost."deleted_at" IS NULL
    AND cost."status" <> 'VOID'
    AND cost."paid" = FALSE
    AND cost."payment_status" NOT IN ('已支付', '部分支付', '已付款', '部分付款')
    AND cost."paid_at" IS NULL
    AND cost."payment_date" IS NULL
    AND cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
    AND cost."source_id" IS NULL
    AND cost."order_id" = expense."order_id"
    AND (cost."supplier_id" IS NULL OR cost."supplier_id" = expense."supplier_id")
    AND NOT EXISTS (
      SELECT 1
      FROM "order_costs" AS other
      WHERE other."id" <> cost."id"
        AND other."source_type" = cost."source_type"
        AND other."source_id" = expense."id"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "order_costs" AS other
      WHERE other."id" <> cost."id"
        AND other."deleted_at" IS NULL
        AND other."status" <> 'VOID'
        AND other."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
        AND other."source_id" = expense."id"
    )
    AND 1 = (
      SELECT COUNT(*)
      FROM "logistics_expenses" AS linked
      WHERE linked."cost_id" = cost."id"
        AND linked."deleted_at" IS NULL
    )
)
UPDATE "order_costs" AS cost
SET "source_id" = repair."expense_id"
FROM repairable_cost_links AS repair
WHERE cost."id" = repair."cost_id"
  AND cost."source_id" IS NULL;

-- Backfill expense.cost_id from one unambiguous active generated source link.
-- Paid or mismatched history is deliberately left untouched for manual review.
WITH unambiguous_generated_cost_links AS (
  SELECT expense."id" AS "expense_id", MIN(cost."id") AS "cost_id"
  FROM "logistics_expenses" AS expense
  INNER JOIN "logistics_bills" AS bill ON bill."id" = expense."bill_id"
  INNER JOIN "order_costs" AS cost ON (
    cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
    AND cost."source_id" = expense."id"
  )
  WHERE expense."cost_id" IS NULL
    AND expense."deleted_at" IS NULL
    AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
    AND bill."deleted_at" IS NULL
    AND bill."status" <> 'voided'
    AND bill."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
    AND cost."deleted_at" IS NULL
    AND cost."status" <> 'VOID'
    AND cost."paid" = FALSE
    AND cost."payment_status" NOT IN ('已支付', '部分支付', '已付款', '部分付款')
    AND cost."paid_at" IS NULL
    AND cost."payment_date" IS NULL
    AND cost."order_id" = expense."order_id"
    AND (cost."supplier_id" IS NULL OR cost."supplier_id" = expense."supplier_id")
  GROUP BY expense."id"
  HAVING COUNT(*) = 1
)
UPDATE "logistics_expenses" AS expense
SET "cost_id" = link."cost_id"
FROM unambiguous_generated_cost_links AS link
WHERE expense."id" = link."expense_id"
  AND expense."cost_id" IS NULL;

UPDATE "logistics_expenses" AS expense
SET "cost_id" = NULL
FROM "order_costs" AS cost, "logistics_bills" AS bill
WHERE expense."cost_id" = cost."id"
  AND expense."bill_id" = bill."id"
  AND expense."deleted_at" IS NULL
  AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND bill."deleted_at" IS NULL
  AND bill."status" <> 'voided'
  AND bill."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND cost."paid" = FALSE
  AND cost."payment_status" NOT IN ('已支付', '部分支付', '已付款', '部分付款')
  AND cost."paid_at" IS NULL
  AND cost."payment_date" IS NULL
  AND (
    cost."deleted_at" IS NOT NULL
    OR cost."status" = 'VOID'
    OR cost."source_type" NOT IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
    OR cost."source_id" IS DISTINCT FROM expense."id"
    OR cost."order_id" IS DISTINCT FROM expense."order_id"
    OR (cost."supplier_id" IS NOT NULL AND cost."supplier_id" IS DISTINCT FROM expense."supplier_id")
  );

-- Quarantine unpaid cross-order/cross-supplier detail associations. Keep the
-- source document record for audit, but detach it from the invalid workflow.
UPDATE "order_costs" AS cost
SET "invoice_status" = '未收到'
WHERE cost."deleted_at" IS NULL
  AND cost."status" <> 'VOID'
  AND cost."paid" = FALSE
  AND cost."payment_status" NOT IN ('已支付', '部分支付', '已付款', '部分付款')
  AND cost."paid_at" IS NULL
  AND cost."payment_date" IS NULL
  AND cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
  AND EXISTS (
    SELECT 1
    FROM "logistics_expenses" AS expense
    INNER JOIN "logistics_bills" AS bill ON bill."id" = expense."bill_id"
    WHERE expense."cost_id" = cost."id"
      AND expense."deleted_at" IS NULL
      AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
      AND bill."status" <> 'voided'
      AND bill."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
      AND (
        expense."order_id" IS DISTINCT FROM bill."order_id"
        OR expense."supplier_id" IS DISTINCT FROM bill."supplier_id"
      )
  );

UPDATE "logistics_expenses" AS expense
SET
  "invoice_status" = '待开票',
  "invoice_document_id" = NULL,
  "invoice_uploaded_by" = NULL,
  "invoice_uploaded_at" = NULL,
  "invoice_validation_status" = '未上传',
  "invoice_validation_message" = '历史费用明细与账单订单或供应商不一致，已隔离发票关联，请先修复账单数据。',
  "invoice_validation_json" = NULL,
  "invoice_ocr_task_id" = NULL,
  "invoice_recognized_no" = NULL,
  "invoice_recognized_date" = NULL,
  "invoice_recognized_seller" = NULL,
  "invoice_recognized_buyer" = NULL,
  "invoice_recognized_amount" = NULL,
  "invoice_recognized_name" = NULL,
  "invoice_manual_confirmed_by" = NULL,
  "invoice_manual_confirmed_at" = NULL,
  "invoice_manual_confirm_reason" = NULL,
  "force_confirm_reason" = NULL,
  "invoice_confirmed_by" = NULL,
  "invoice_confirmed_at" = NULL
FROM "logistics_bills" AS bill
WHERE expense."bill_id" = bill."id"
  AND expense."deleted_at" IS NULL
  AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND NOT EXISTS (
    SELECT 1
    FROM "order_costs" AS cost
    WHERE (
        cost."id" = expense."cost_id"
        OR (
          cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
          AND cost."source_id" = expense."id"
        )
      )
      AND (
        cost."paid" = TRUE
        OR cost."payment_status" IN ('已支付', '部分支付', '已付款', '部分付款')
        OR cost."paid_at" IS NOT NULL
        OR cost."payment_date" IS NOT NULL
      )
  )
  AND bill."status" <> 'voided'
  AND bill."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND (
    expense."order_id" IS DISTINCT FROM bill."order_id"
    OR expense."supplier_id" IS DISTINCT FROM bill."supplier_id"
  );

-- A status flag alone is not an invoice. Reopen uploaded/confirmed rows whose
-- PDF is missing, deleted, or did not finish uploading.
UPDATE "order_costs" AS cost
SET "invoice_status" = '未收到'
WHERE cost."deleted_at" IS NULL
  AND cost."status" <> 'VOID'
  AND cost."paid" = FALSE
  AND cost."payment_status" NOT IN ('已支付', '部分支付', '已付款', '部分付款')
  AND cost."paid_at" IS NULL
  AND cost."payment_date" IS NULL
  AND cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
  AND EXISTS (
    SELECT 1
    FROM "logistics_expenses" AS expense
    WHERE expense."cost_id" = cost."id"
      AND expense."deleted_at" IS NULL
      AND expense."invoice_status" IN ('已上传', '已确认')
      AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
      AND NOT EXISTS (
        SELECT 1
        FROM "logistics_bills" AS bill
        WHERE bill."id" = expense."bill_id"
          AND (
            bill."status" = 'voided'
            OR bill."payment_status" IN ('已付款', '部分付款', '部分已付款')
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "order_documents" AS document
        WHERE document."id" = expense."invoice_document_id"
          AND document."deleted_at" IS NULL
          AND document."upload_status" = 'SUCCESS'
          AND document."document_type" = 'SUPPLIER_INVOICE'
          AND document."related_module" = 'SUPPLIER'
          AND LOWER(TRIM(document."mime_type")) = 'application/pdf'
          AND document."file_size" > 0
          AND NULLIF(TRIM(document."r2_key"), '') IS NOT NULL
          AND document."order_id" = expense."order_id"
          AND document."supplier_id" = expense."supplier_id"
      )
  );

UPDATE "logistics_expenses" AS expense
SET
  "invoice_status" = '待开票',
  "invoice_document_id" = NULL,
  "invoice_uploaded_by" = NULL,
  "invoice_uploaded_at" = NULL,
  "invoice_validation_status" = '未上传',
  "invoice_validation_message" = '历史发票文件不存在、已删除或关联错误，请重新上传。',
  "invoice_validation_json" = NULL,
  "invoice_ocr_task_id" = NULL,
  "invoice_recognized_no" = NULL,
  "invoice_recognized_date" = NULL,
  "invoice_recognized_seller" = NULL,
  "invoice_recognized_buyer" = NULL,
  "invoice_recognized_amount" = NULL,
  "invoice_recognized_name" = NULL,
  "invoice_manual_confirmed_by" = NULL,
  "invoice_manual_confirmed_at" = NULL,
  "invoice_manual_confirm_reason" = NULL,
  "force_confirm_reason" = NULL,
  "invoice_confirmed_by" = NULL,
  "invoice_confirmed_at" = NULL
WHERE expense."invoice_status" IN ('已上传', '已确认')
  AND expense."deleted_at" IS NULL
  AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND NOT EXISTS (
    SELECT 1
    FROM "order_costs" AS cost
    WHERE (
        cost."id" = expense."cost_id"
        OR (
          cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
          AND cost."source_id" = expense."id"
        )
      )
      AND (
        cost."paid" = TRUE
        OR cost."payment_status" IN ('已支付', '部分支付', '已付款', '部分付款')
        OR cost."paid_at" IS NOT NULL
        OR cost."payment_date" IS NOT NULL
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_bills" AS bill
    WHERE bill."id" = expense."bill_id"
      AND (
        bill."status" = 'voided'
        OR bill."payment_status" IN ('已付款', '部分付款', '部分已付款')
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "order_documents" AS document
    WHERE document."id" = expense."invoice_document_id"
      AND document."deleted_at" IS NULL
      AND document."upload_status" = 'SUCCESS'
      AND document."document_type" = 'SUPPLIER_INVOICE'
      AND document."related_module" = 'SUPPLIER'
      AND LOWER(TRIM(document."mime_type")) = 'application/pdf'
      AND document."file_size" > 0
      AND NULLIF(TRIM(document."r2_key"), '') IS NOT NULL
      AND document."order_id" = expense."order_id"
      AND document."supplier_id" = expense."supplier_id"
  );

-- A confirmed flag without a finance confirmer and timestamp is only an upload.
UPDATE "logistics_expenses" AS expense
SET
  "invoice_status" = '已上传',
  "invoice_confirmed_by" = NULL,
  "invoice_confirmed_at" = NULL,
  "force_confirm_reason" = NULL
WHERE expense."invoice_status" = '已确认'
  AND expense."deleted_at" IS NULL
  AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND NOT EXISTS (
    SELECT 1
    FROM "order_costs" AS cost
    WHERE (
        cost."id" = expense."cost_id"
        OR (
          cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
          AND cost."source_id" = expense."id"
        )
      )
      AND (
        cost."paid" = TRUE
        OR cost."payment_status" IN ('已支付', '部分支付', '已付款', '部分付款')
        OR cost."paid_at" IS NOT NULL
        OR cost."payment_date" IS NOT NULL
      )
  )
  AND (expense."invoice_confirmed_by" IS NULL OR expense."invoice_confirmed_at" IS NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_bills" AS bill
    WHERE bill."id" = expense."bill_id"
      AND (
        bill."status" = 'voided'
        OR bill."payment_status" IN ('已付款', '部分付款', '部分已付款')
      )
  );

-- Historical non-empty CNY fee types outside the current options are surfaced
-- in the trucking/other group by the runtime compatibility mapper. New writes
-- remain restricted to the configured fee-type list.

-- One PDF may cover multiple rows in one group, but not another group or bill.
WITH active_invoice_groups AS (
  SELECT
    "bill_id",
    "invoice_document_id",
    CASE
      WHEN UPPER(COALESCE("currency", 'CNY')) = 'USD' THEN 'OCEAN_FREIGHT'
      WHEN "cost_type" = '报关费' THEN 'CUSTOMS'
      WHEN "cost_type" = '港杂费' THEN 'PORT_CHARGES'
      WHEN "cost_type" IN ('海运费', 'ENS', 'ENS费', '保险费', '其他国际费用') THEN 'OCEAN_FREIGHT'
      WHEN "cost_type" IN ('拖车费', '打单费', '进港费', '提箱费', '落箱费', '预提费', '查验费', '超重费', '其他本地费用', '其他物流费用') THEN 'TRUCKING_OTHER'
      ELSE 'TRUCKING_OTHER'
    END AS "invoice_group"
  FROM "logistics_expenses" AS expense
  WHERE expense."deleted_at" IS NULL
    AND expense."invoice_status" IN ('已上传', '已确认')
    AND expense."bill_id" IS NOT NULL
    AND expense."invoice_document_id" IS NOT NULL
), reused_documents AS (
  SELECT "invoice_document_id"
  FROM active_invoice_groups
  GROUP BY "invoice_document_id"
  HAVING COUNT(DISTINCT ("bill_id", "invoice_group")) > 1
)
UPDATE "logistics_expenses" AS expense
SET
  "invoice_status" = '待开票',
  "invoice_document_id" = NULL,
  "invoice_uploaded_by" = NULL,
  "invoice_uploaded_at" = NULL,
  "invoice_validation_status" = '未上传',
  "invoice_validation_message" = '历史发票文件被不同发票分组或账单重复引用，已隔离关联，请重新上传。',
  "invoice_validation_json" = NULL,
  "invoice_ocr_task_id" = NULL,
  "invoice_recognized_no" = NULL,
  "invoice_recognized_date" = NULL,
  "invoice_recognized_seller" = NULL,
  "invoice_recognized_buyer" = NULL,
  "invoice_recognized_amount" = NULL,
  "invoice_recognized_name" = NULL,
  "invoice_manual_confirmed_by" = NULL,
  "invoice_manual_confirmed_at" = NULL,
  "invoice_manual_confirm_reason" = NULL,
  "invoice_confirmed_by" = NULL,
  "invoice_confirmed_at" = NULL,
  "force_confirm_reason" = NULL
FROM reused_documents
WHERE expense."invoice_document_id" = reused_documents."invoice_document_id"
  AND expense."deleted_at" IS NULL
  AND expense."invoice_status" IN ('已上传', '已确认')
  AND expense."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND NOT EXISTS (
    SELECT 1
    FROM "order_costs" AS cost
    WHERE (
        cost."id" = expense."cost_id"
        OR (
          cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
          AND cost."source_id" = expense."id"
        )
      )
      AND (
        cost."paid" = TRUE
        OR cost."payment_status" IN ('已支付', '部分支付', '已付款', '部分付款')
        OR cost."paid_at" IS NOT NULL
        OR cost."payment_date" IS NOT NULL
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_bills" AS bill
    WHERE bill."id" = expense."bill_id"
      AND (
        bill."status" = 'voided'
        OR bill."payment_status" IN ('已付款', '部分付款', '部分已付款')
      )
  );

UPDATE "order_costs" AS cost
SET "invoice_status" = '未收到'
WHERE cost."deleted_at" IS NULL
  AND cost."status" <> 'VOID'
  AND cost."paid" = FALSE
  AND cost."payment_status" NOT IN ('已支付', '部分支付', '已付款', '部分付款')
  AND cost."paid_at" IS NULL
  AND cost."payment_date" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "logistics_expenses" AS expense
    WHERE expense."deleted_at" IS NULL
      AND expense."invoice_validation_message" = '历史发票文件被不同发票分组或账单重复引用，已隔离关联，请重新上传。'
      AND (
        cost."id" = expense."cost_id"
        OR (
          cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
          AND cost."source_id" = expense."id"
        )
      )
  );

-- Rebuild bill invoice status from real, non-deleted invoice-linked detail rows.
UPDATE "logistics_bills" AS bill
SET "invoice_status" = CASE
  WHEN status_counts."total_count" > 0
    AND status_counts."confirmed_count" = status_counts."total_count"
    THEN '已确认发票'
  WHEN status_counts."total_count" > 0
    AND status_counts."uploaded_count" = status_counts."total_count"
    THEN '已上传发票'
  WHEN status_counts."uploaded_count" > 0
    THEN '部分上传发票'
  ELSE '待开票'
END
FROM (
  SELECT
    "bill_id",
    COUNT(*) AS "total_count",
    COUNT(*) FILTER (
      WHERE "invoice_status" = '已确认'
        AND "invoice_confirmed_by" IS NOT NULL
        AND "invoice_confirmed_at" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "order_documents" AS document
          WHERE document."id" = "logistics_expenses"."invoice_document_id"
            AND document."deleted_at" IS NULL
            AND document."upload_status" = 'SUCCESS'
            AND document."document_type" = 'SUPPLIER_INVOICE'
            AND document."related_module" = 'SUPPLIER'
            AND LOWER(TRIM(document."mime_type")) = 'application/pdf'
            AND document."file_size" > 0
            AND NULLIF(TRIM(document."r2_key"), '') IS NOT NULL
            AND document."order_id" = "logistics_expenses"."order_id"
            AND document."supplier_id" = "logistics_expenses"."supplier_id"
        )
    ) AS "confirmed_count",
    COUNT(*) FILTER (
      WHERE "invoice_status" IN ('已上传', '已确认')
        AND EXISTS (
          SELECT 1
          FROM "order_documents" AS document
          WHERE document."id" = "logistics_expenses"."invoice_document_id"
            AND document."deleted_at" IS NULL
            AND document."upload_status" = 'SUCCESS'
            AND document."document_type" = 'SUPPLIER_INVOICE'
            AND document."related_module" = 'SUPPLIER'
            AND LOWER(TRIM(document."mime_type")) = 'application/pdf'
            AND document."file_size" > 0
            AND NULLIF(TRIM(document."r2_key"), '') IS NOT NULL
            AND document."order_id" = "logistics_expenses"."order_id"
            AND document."supplier_id" = "logistics_expenses"."supplier_id"
        )
    ) AS "uploaded_count"
  FROM "logistics_expenses"
  WHERE "deleted_at" IS NULL
    AND "bill_id" IS NOT NULL
  GROUP BY "bill_id"
) AS status_counts
WHERE bill."id" = status_counts."bill_id"
  AND bill."deleted_at" IS NULL
  AND bill."status" <> 'voided'
  AND bill."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_expenses" AS expense
    INNER JOIN "order_costs" AS cost ON (
      cost."id" = expense."cost_id"
      OR (
        cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
        AND cost."source_id" = expense."id"
      )
    )
    WHERE expense."bill_id" = bill."id"
      AND (
        cost."paid" = TRUE
        OR cost."payment_status" IN ('已支付', '部分支付', '已付款', '部分付款')
        OR cost."paid_at" IS NOT NULL
        OR cost."payment_date" IS NOT NULL
      )
  );

-- Isolate orphan bills so stale historical flags cannot become payable.
UPDATE "logistics_bills" AS bill
SET
  "invoice_status" = '待开票',
  "payment_status" = '待开票'
WHERE bill."deleted_at" IS NULL
  AND bill."status" <> 'voided'
  AND bill."payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_expenses" AS expense
    INNER JOIN "order_costs" AS cost ON (
      cost."id" = expense."cost_id"
      OR (
        cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
        AND cost."source_id" = expense."id"
      )
    )
    WHERE expense."bill_id" = bill."id"
      AND (
        cost."paid" = TRUE
        OR cost."payment_status" IN ('已支付', '部分支付', '已付款', '部分付款')
        OR cost."paid_at" IS NOT NULL
        OR cost."payment_date" IS NOT NULL
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_expenses" AS expense
    WHERE expense."bill_id" = bill."id"
      AND expense."deleted_at" IS NULL
  );

-- Unpaid bills become payable only after every invoice group is confirmed.
UPDATE "logistics_bills"
SET "payment_status" = CASE
  WHEN "audit_status" = '审核通过'
    AND "invoice_status" = '已确认发票'
    THEN '待付款'
  ELSE '待开票'
END
WHERE "deleted_at" IS NULL
  AND "status" <> 'voided'
  AND "payment_status" NOT IN ('已付款', '部分付款', '部分已付款')
  AND NOT EXISTS (
    SELECT 1
    FROM "logistics_expenses" AS expense
    INNER JOIN "order_costs" AS cost ON (
      cost."id" = expense."cost_id"
      OR (
        cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
        AND cost."source_id" = expense."id"
      )
    )
    WHERE expense."bill_id" = "logistics_bills"."id"
      AND (
        cost."paid" = TRUE
        OR cost."payment_status" IN ('已支付', '部分支付', '已付款', '部分付款')
        OR cost."paid_at" IS NOT NULL
        OR cost."payment_date" IS NOT NULL
      )
  );

-- Keep approval, invoice, and payment as independent workflow states. Apply
-- the short AccessExclusive default changes at the end of the transaction.
ALTER TABLE "logistics_bills"
  ALTER COLUMN "invoice_status" SET DEFAULT '待开票';

ALTER TABLE "logistics_expenses"
  ALTER COLUMN "invoice_status" SET DEFAULT '待开票';

COMMIT;
