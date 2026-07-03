CREATE TABLE IF NOT EXISTS "customs_declarations" (
  "id" TEXT NOT NULL,
  "shipment_id" TEXT,
  "order_id" TEXT NOT NULL,
  "bill_of_lading_no" TEXT,
  "declaration_no" TEXT,
  "declaration_date" DATE,
  "purchase_order_id" TEXT,
  "supplier_id" TEXT,
  "pdf_document_id" TEXT,
  "tax_refund_status" TEXT NOT NULL DEFAULT 'NOT_READY',
  "tax_refund_completeness" JSONB,
  "tax_refund_completeness_updated_at" TIMESTAMP(3),
  "tax_refund_overall_completeness" INTEGER,
  "tax_refund_completeness_issues_summary" TEXT,
  "tax_archived" BOOLEAN NOT NULL DEFAULT false,
  "tax_refund_archived_by" TEXT,
  "tax_refund_archived_at" TIMESTAMP(3),
  "tax_refund_archive_remark" TEXT,
  "tax_submitted_by" TEXT,
  "tax_submitted_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customs_declarations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customs_declarations_pdf_document_id_key" ON "customs_declarations"("pdf_document_id");
CREATE INDEX IF NOT EXISTS "customs_declarations_shipment_id_idx" ON "customs_declarations"("shipment_id");
CREATE INDEX IF NOT EXISTS "customs_declarations_order_id_idx" ON "customs_declarations"("order_id");
CREATE INDEX IF NOT EXISTS "customs_declarations_bill_of_lading_no_idx" ON "customs_declarations"("bill_of_lading_no");
CREATE INDEX IF NOT EXISTS "customs_declarations_declaration_no_idx" ON "customs_declarations"("declaration_no");
CREATE INDEX IF NOT EXISTS "customs_declarations_declaration_date_idx" ON "customs_declarations"("declaration_date");
CREATE INDEX IF NOT EXISTS "customs_declarations_purchase_order_id_idx" ON "customs_declarations"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "customs_declarations_supplier_id_idx" ON "customs_declarations"("supplier_id");
CREATE INDEX IF NOT EXISTS "customs_declarations_tax_refund_status_idx" ON "customs_declarations"("tax_refund_status");
CREATE INDEX IF NOT EXISTS "customs_declarations_tax_refund_overall_completeness_idx" ON "customs_declarations"("tax_refund_overall_completeness");
CREATE INDEX IF NOT EXISTS "customs_declarations_tax_archived_idx" ON "customs_declarations"("tax_archived");
CREATE INDEX IF NOT EXISTS "customs_declarations_deleted_at_idx" ON "customs_declarations"("deleted_at");
CREATE INDEX IF NOT EXISTS "customs_declarations_bl_date_idx" ON "customs_declarations"("deleted_at", "bill_of_lading_no", "declaration_date");
CREATE INDEX IF NOT EXISTS "customs_declarations_tax_list_idx" ON "customs_declarations"("deleted_at", "tax_archived", "tax_refund_status", "updated_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declarations_order_id_fkey') THEN
    ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declarations_purchase_order_id_fkey') THEN
    ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "order_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declarations_supplier_id_fkey') THEN
    ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declarations_pdf_document_id_fkey') THEN
    ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_pdf_document_id_fkey"
      FOREIGN KEY ("pdf_document_id") REFERENCES "order_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declarations_tax_refund_archived_by_fkey') THEN
    ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_tax_refund_archived_by_fkey"
      FOREIGN KEY ("tax_refund_archived_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declarations_tax_submitted_by_fkey') THEN
    ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_tax_submitted_by_fkey"
      FOREIGN KEY ("tax_submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

WITH latest_customs_pdf AS (
  SELECT DISTINCT ON ("order_id")
    "id",
    "order_id",
    "supplier_id",
    "cost_id"
  FROM "order_documents"
  WHERE "deleted_at" IS NULL
    AND "document_type" = 'CUSTOMS_ENTRY_FORM'
    AND "upload_status" = 'SUCCESS'
  ORDER BY "order_id", COALESCE("uploaded_at", "created_at") DESC, "created_at" DESC
)
INSERT INTO "customs_declarations" (
  "id",
  "order_id",
  "bill_of_lading_no",
  "declaration_no",
  "declaration_date",
  "purchase_order_id",
  "supplier_id",
  "pdf_document_id",
  "tax_refund_status",
  "tax_refund_completeness",
  "tax_refund_completeness_updated_at",
  "tax_refund_overall_completeness",
  "tax_refund_completeness_issues_summary",
  "tax_archived",
  "tax_refund_archived_by",
  "tax_refund_archived_at",
  "tax_refund_archive_remark",
  "tax_submitted_by",
  "tax_submitted_at",
  "status",
  "source",
  "created_at",
  "updated_at",
  "deleted_at"
)
SELECT
  'cd_' || md5(o."id") AS "id",
  o."id" AS "order_id",
  o."bl_no" AS "bill_of_lading_no",
  o."customs_declaration_no" AS "declaration_no",
  o."customs_declaration_date" AS "declaration_date",
  p."cost_id" AS "purchase_order_id",
  p."supplier_id" AS "supplier_id",
  p."id" AS "pdf_document_id",
  o."tax_refund_status",
  o."tax_refund_completeness",
  o."tax_refund_completeness_updated_at",
  o."tax_refund_overall_completeness",
  o."tax_refund_completeness_issues_summary",
  o."tax_archived",
  o."tax_refund_archived_by",
  o."tax_refund_archived_at",
  o."tax_refund_archive_remark",
  o."tax_submitted_by",
  o."tax_submitted_at",
  CASE WHEN o."deleted_at" IS NULL THEN 'ACTIVE' ELSE 'DELETED' END AS "status",
  'MIGRATED' AS "source",
  o."created_at",
  now(),
  o."deleted_at"
FROM "receivable_orders" o
LEFT JOIN latest_customs_pdf p ON p."order_id" = o."id"
WHERE p."id" IS NOT NULL
   OR NULLIF(TRIM(COALESCE(o."customs_declaration_no", '')), '') IS NOT NULL
   OR o."customs_declaration_date" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
