ALTER TABLE "ocr_raw_results" ADD COLUMN IF NOT EXISTS "tax_refund_id" TEXT;

CREATE INDEX IF NOT EXISTS "ocr_raw_results_tax_refund_id_idx"
  ON "ocr_raw_results"("tax_refund_id");

CREATE OR REPLACE VIEW "customs_declaration_items" AS
SELECT
  "id",
  "order_id" AS "tax_refund_id",
  "document_id",
  "declaration_no",
  "hs_code",
  "product_name",
  "specification",
  "quantity",
  "unit",
  "unit_price",
  "total_amount",
  "currency",
  "gross_weight",
  "net_weight",
  "origin_country",
  "destination_country",
  "confirmation_status",
  "source",
  "created_at",
  "updated_at"
FROM "export_customs_declaration_items"
WHERE "deleted_at" IS NULL;
