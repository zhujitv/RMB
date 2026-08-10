-- Reconcile historical logistics-generated costs whose authoritative bill is fully paid.
--
-- Older payment workflows updated the human-readable cost payment status and date,
-- but could leave the redundant `paid` / `paid_at` fields unset. Match every business
-- identifier and financial fingerprint before correcting those redundant fields so
-- unrelated or manually-entered costs are never changed.
UPDATE "order_costs" AS cost
SET
  "paid" = TRUE,
  "paid_at" = bill."payment_date",
  "updated_at" = CURRENT_TIMESTAMP
FROM "logistics_expenses" AS expense
INNER JOIN "logistics_bills" AS bill
  ON bill."id" = expense."bill_id"
WHERE expense."cost_id" = cost."id"
  AND expense."deleted_at" IS NULL
  AND bill."deleted_at" IS NULL
  AND bill."status" <> 'voided'
  AND bill."audit_status" = '审核通过'
  AND bill."payment_status" IN ('已付款', '已支付')
  AND bill."payment_date" IS NOT NULL
  AND bill."order_id" = expense."order_id"
  AND bill."supplier_id" IS NOT DISTINCT FROM expense."supplier_id"
  AND cost."deleted_at" IS NULL
  AND cost."status" <> 'VOID'
  AND cost."source_type" IN ('LOGISTICS_FEE', 'LOGISTICS_EXPENSE')
  AND cost."source_id" = expense."id"
  AND cost."order_id" = expense."order_id"
  AND cost."supplier_id" IS NOT DISTINCT FROM expense."supplier_id"
  AND cost."cost_type" = expense."cost_type"
  AND cost."currency" = expense."currency"
  AND cost."amount" = expense."amount"
  AND cost."amount_cny" = expense."amount_cny"
  AND cost."payment_status" IN ('已支付', '已付款')
  AND cost."payment_date" = bill."payment_date"
  AND (
    cost."paid" IS DISTINCT FROM TRUE
    OR cost."paid_at" IS DISTINCT FROM bill."payment_date"
  );
