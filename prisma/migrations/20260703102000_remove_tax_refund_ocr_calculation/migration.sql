-- 退税资料模块回归稳定版：状态只保留资料流转，不再保留 OCR/退税计算状态。
UPDATE "receivable_orders"
SET "tax_refund_status" = 'NOT_READY'
WHERE "tax_refund_status" IN (
  'NO_CUSTOMS',
  'CUSTOMS_RECOGNIZED_PENDING_CONFIRM',
  'HS_NOT_MAINTAINED',
  'REBATE_RATE_MATCHED',
  'SUPPLIER_INVOICE_MATCHED',
  'REFUND_CALCULATED'
);

-- 删除退税模块专用的报关商品视图和计算表；通用 OCR、供应商资料回传 OCR、企业 HS 主数据保留。
DROP VIEW IF EXISTS "customs_declaration_items" CASCADE;

DROP TABLE IF EXISTS "tax_refund_supplier_invoice_matches" CASCADE;
DROP TABLE IF EXISTS "tax_refund_hs_matches" CASCADE;
DROP TABLE IF EXISTS "tax_refund_calculation_items" CASCADE;
DROP TABLE IF EXISTS "tax_refund_calculations" CASCADE;
DROP TABLE IF EXISTS "tax_refund_ocr_results" CASCADE;
DROP TABLE IF EXISTS "tax_refund_ocr_tasks" CASCADE;
DROP TABLE IF EXISTS "customs_declaration_ocr_results" CASCADE;

DROP TABLE IF EXISTS "export_tax_refund_calculations" CASCADE;
DROP TABLE IF EXISTS "export_customs_declaration_items" CASCADE;
DROP TABLE IF EXISTS "export_tax_rebate_rates" CASCADE;
