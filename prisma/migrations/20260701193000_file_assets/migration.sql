CREATE TABLE IF NOT EXISTS "file_assets" (
  "id" TEXT NOT NULL,
  "file_url" TEXT,
  "file_name" TEXT NOT NULL,
  "original_file_name" TEXT,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER,
  "storage_key" TEXT NOT NULL,
  "bucket" TEXT,
  "uploaded_at" TIMESTAMP(3),
  "uploaded_by" TEXT,
  "binding_type" TEXT NOT NULL,
  "source_table" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "file_role" TEXT NOT NULL,
  "order_id" TEXT,
  "cost_id" TEXT,
  "supplier_id" TEXT,
  "logistics_expense_id" TEXT,
  "supplier_document_request_id" TEXT,
  "order_document_id" TEXT,
  "tax_refund_document_type" TEXT,
  "related_module" TEXT,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "file_assets_source_unique"
ON "file_assets"("source_table", "source_id", "file_role");

CREATE INDEX IF NOT EXISTS "file_assets_binding_type_idx" ON "file_assets"("binding_type");
CREATE INDEX IF NOT EXISTS "file_assets_source_table_source_id_idx" ON "file_assets"("source_table", "source_id");
CREATE INDEX IF NOT EXISTS "file_assets_file_role_idx" ON "file_assets"("file_role");
CREATE INDEX IF NOT EXISTS "file_assets_order_id_idx" ON "file_assets"("order_id");
CREATE INDEX IF NOT EXISTS "file_assets_cost_id_idx" ON "file_assets"("cost_id");
CREATE INDEX IF NOT EXISTS "file_assets_supplier_id_idx" ON "file_assets"("supplier_id");
CREATE INDEX IF NOT EXISTS "file_assets_logistics_expense_id_idx" ON "file_assets"("logistics_expense_id");
CREATE INDEX IF NOT EXISTS "file_assets_supplier_document_request_id_idx" ON "file_assets"("supplier_document_request_id");
CREATE INDEX IF NOT EXISTS "file_assets_order_document_id_idx" ON "file_assets"("order_document_id");
CREATE INDEX IF NOT EXISTS "file_assets_tax_refund_document_type_idx" ON "file_assets"("tax_refund_document_type");
CREATE INDEX IF NOT EXISTS "file_assets_uploaded_by_idx" ON "file_assets"("uploaded_by");
CREATE INDEX IF NOT EXISTS "file_assets_is_deleted_idx" ON "file_assets"("is_deleted");
CREATE INDEX IF NOT EXISTS "file_assets_deleted_at_idx" ON "file_assets"("deleted_at");

INSERT INTO "file_assets" (
  "id",
  "file_url",
  "file_name",
  "original_file_name",
  "mime_type",
  "file_size",
  "storage_key",
  "bucket",
  "uploaded_at",
  "uploaded_by",
  "binding_type",
  "source_table",
  "source_id",
  "file_role",
  "order_id",
  "cost_id",
  "supplier_id",
  "supplier_document_request_id",
  "order_document_id",
  "tax_refund_document_type",
  "related_module",
  "is_deleted",
  "deleted_at",
  "created_at",
  "updated_at"
)
SELECT
  'fa_od_' || md5("id") AS "id",
  "file_url",
  COALESCE(NULLIF("standard_filename", ''), NULLIF("file_name", ''), NULLIF("original_filename", ''), NULLIF("original_name", ''), '文件') AS "file_name",
  COALESCE(NULLIF("original_filename", ''), NULLIF("original_name", ''), NULLIF("file_name", '')) AS "original_file_name",
  COALESCE(NULLIF("mime_type", ''), 'application/octet-stream') AS "mime_type",
  "file_size",
  "r2_key" AS "storage_key",
  "r2_bucket" AS "bucket",
  "uploaded_at",
  "uploaded_by",
  'ORDER_DOCUMENT' AS "binding_type",
  'order_documents' AS "source_table",
  "id" AS "source_id",
  "document_type"::TEXT AS "file_role",
  "order_id",
  "cost_id",
  "supplier_id",
  "factory_document_request_id" AS "supplier_document_request_id",
  "id" AS "order_document_id",
  "document_type"::TEXT AS "tax_refund_document_type",
  "related_module",
  ("deleted_at" IS NOT NULL) AS "is_deleted",
  "deleted_at",
  "created_at",
  "updated_at"
FROM "order_documents"
WHERE COALESCE(NULLIF("r2_key", ''), '') <> ''
ON CONFLICT ("source_table", "source_id", "file_role") DO UPDATE SET
  "file_url" = EXCLUDED."file_url",
  "file_name" = EXCLUDED."file_name",
  "original_file_name" = EXCLUDED."original_file_name",
  "mime_type" = EXCLUDED."mime_type",
  "file_size" = EXCLUDED."file_size",
  "storage_key" = EXCLUDED."storage_key",
  "bucket" = EXCLUDED."bucket",
  "uploaded_at" = EXCLUDED."uploaded_at",
  "uploaded_by" = EXCLUDED."uploaded_by",
  "binding_type" = EXCLUDED."binding_type",
  "order_id" = EXCLUDED."order_id",
  "cost_id" = EXCLUDED."cost_id",
  "supplier_id" = EXCLUDED."supplier_id",
  "supplier_document_request_id" = EXCLUDED."supplier_document_request_id",
  "order_document_id" = EXCLUDED."order_document_id",
  "tax_refund_document_type" = EXCLUDED."tax_refund_document_type",
  "related_module" = EXCLUDED."related_module",
  "is_deleted" = EXCLUDED."is_deleted",
  "deleted_at" = EXCLUDED."deleted_at",
  "updated_at" = EXCLUDED."updated_at";

INSERT INTO "file_assets" (
  "id",
  "file_url",
  "file_name",
  "original_file_name",
  "mime_type",
  "storage_key",
  "bucket",
  "uploaded_at",
  "uploaded_by",
  "binding_type",
  "source_table",
  "source_id",
  "file_role",
  "order_id",
  "cost_id",
  "supplier_id",
  "related_module",
  "is_deleted",
  "deleted_at",
  "created_at",
  "updated_at"
)
SELECT
  'fa_pv_' || md5("id") AS "id",
  "payment_voucher_url",
  COALESCE(NULLIF("payment_voucher_file_name", ''), '汇款水单') AS "file_name",
  NULLIF("payment_voucher_file_name", '') AS "original_file_name",
  COALESCE(NULLIF("payment_voucher_mime_type", ''), 'application/octet-stream') AS "mime_type",
  "payment_voucher_storage_key" AS "storage_key",
  "payment_voucher_bucket" AS "bucket",
  "payment_voucher_uploaded_at" AS "uploaded_at",
  "updated_by" AS "uploaded_by",
  'PAYMENT_VOUCHER' AS "binding_type",
  'order_costs' AS "source_table",
  "id" AS "source_id",
  'PAYMENT_VOUCHER' AS "file_role",
  "order_id",
  "id" AS "cost_id",
  "supplier_id",
  'COST_PAYMENT' AS "related_module",
  ("deleted_at" IS NOT NULL) AS "is_deleted",
  "deleted_at",
  "created_at",
  "updated_at"
FROM "order_costs"
WHERE COALESCE(NULLIF("payment_voucher_storage_key", ''), '') <> ''
ON CONFLICT ("source_table", "source_id", "file_role") DO UPDATE SET
  "file_url" = EXCLUDED."file_url",
  "file_name" = EXCLUDED."file_name",
  "original_file_name" = EXCLUDED."original_file_name",
  "mime_type" = EXCLUDED."mime_type",
  "storage_key" = EXCLUDED."storage_key",
  "bucket" = EXCLUDED."bucket",
  "uploaded_at" = EXCLUDED."uploaded_at",
  "uploaded_by" = EXCLUDED."uploaded_by",
  "binding_type" = EXCLUDED."binding_type",
  "order_id" = EXCLUDED."order_id",
  "cost_id" = EXCLUDED."cost_id",
  "supplier_id" = EXCLUDED."supplier_id",
  "related_module" = EXCLUDED."related_module",
  "is_deleted" = EXCLUDED."is_deleted",
  "deleted_at" = EXCLUDED."deleted_at",
  "updated_at" = EXCLUDED."updated_at";

INSERT INTO "file_assets" (
  "id",
  "file_name",
  "original_file_name",
  "mime_type",
  "file_size",
  "storage_key",
  "bucket",
  "uploaded_at",
  "uploaded_by",
  "binding_type",
  "source_table",
  "source_id",
  "file_role",
  "order_id",
  "supplier_id",
  "supplier_document_request_id",
  "related_module",
  "is_deleted",
  "deleted_at",
  "created_at",
  "updated_at"
)
SELECT
  'fa_srt_' || md5("id") AS "id",
  COALESCE(NULLIF("template_original_name", ''), NULLIF("template_file_name", ''), 'factory-document-template.xlsx') AS "file_name",
  COALESCE(NULLIF("template_original_name", ''), NULLIF("template_file_name", '')) AS "original_file_name",
  COALESCE(NULLIF("template_mime_type", ''), 'application/octet-stream') AS "mime_type",
  "template_file_size" AS "file_size",
  "template_storage_key" AS "storage_key",
  "template_bucket" AS "bucket",
  "created_at" AS "uploaded_at",
  "requested_by" AS "uploaded_by",
  'SUPPLIER_REQUEST_TEMPLATE' AS "binding_type",
  'supplier_document_requests' AS "source_table",
  "id" AS "source_id",
  'SUPPLIER_REQUEST_TEMPLATE' AS "file_role",
  "order_id",
  "supplier_id",
  "id" AS "supplier_document_request_id",
  'SUPPLIER_REQUEST_TEMPLATE' AS "related_module",
  ("deleted_at" IS NOT NULL) AS "is_deleted",
  "deleted_at",
  "created_at",
  "updated_at"
FROM "supplier_document_requests"
WHERE COALESCE(NULLIF("template_storage_key", ''), '') <> ''
ON CONFLICT ("source_table", "source_id", "file_role") DO UPDATE SET
  "file_name" = EXCLUDED."file_name",
  "original_file_name" = EXCLUDED."original_file_name",
  "mime_type" = EXCLUDED."mime_type",
  "file_size" = EXCLUDED."file_size",
  "storage_key" = EXCLUDED."storage_key",
  "bucket" = EXCLUDED."bucket",
  "uploaded_at" = EXCLUDED."uploaded_at",
  "uploaded_by" = EXCLUDED."uploaded_by",
  "binding_type" = EXCLUDED."binding_type",
  "order_id" = EXCLUDED."order_id",
  "supplier_id" = EXCLUDED."supplier_id",
  "supplier_document_request_id" = EXCLUDED."supplier_document_request_id",
  "related_module" = EXCLUDED."related_module",
  "is_deleted" = EXCLUDED."is_deleted",
  "deleted_at" = EXCLUDED."deleted_at",
  "updated_at" = EXCLUDED."updated_at";
