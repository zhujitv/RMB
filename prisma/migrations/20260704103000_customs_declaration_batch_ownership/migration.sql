ALTER TABLE "customs_declarations" ADD COLUMN IF NOT EXISTS "customer_id" TEXT;
ALTER TABLE "customs_declarations" ADD COLUMN IF NOT EXISTS "batch_no" TEXT;
ALTER TABLE "customs_declarations" ADD COLUMN IF NOT EXISTS "tax_record_id" TEXT;
ALTER TABLE "customs_declarations" ADD COLUMN IF NOT EXISTS "declaration_amount" DECIMAL(18,2);
ALTER TABLE "customs_declarations" ADD COLUMN IF NOT EXISTS "container_count" INTEGER;

ALTER TABLE "supplier_document_requests" ADD COLUMN IF NOT EXISTS "customs_declaration_id" TEXT;
ALTER TABLE "supplier_document_requests" ADD COLUMN IF NOT EXISTS "required_invoice_amount" DECIMAL(18,2);

ALTER TABLE "logistics_expenses" ADD COLUMN IF NOT EXISTS "customs_declaration_id" TEXT;
ALTER TABLE "logistics_expenses" ADD COLUMN IF NOT EXISTS "allocation_method" TEXT;
ALTER TABLE "logistics_expenses" ADD COLUMN IF NOT EXISTS "allocated_amount" DECIMAL(18,2);

CREATE TABLE IF NOT EXISTS "customs_declaration_documents" (
  "id" TEXT NOT NULL,
  "customs_declaration_id" TEXT NOT NULL,
  "document_type" TEXT NOT NULL,
  "file_id" TEXT NOT NULL,
  "uploaded_by_user_id" TEXT,
  "uploaded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customs_declaration_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "customs_declaration_suppliers" (
  "id" TEXT NOT NULL,
  "customs_declaration_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "purchase_order_id" TEXT,
  "required_invoice_amount" DECIMAL(18,2),
  "contract_file_id" TEXT,
  "vat_invoice_file_id" TEXT,
  "contract_amount" DECIMAL(18,2),
  "vat_invoice_amount" DECIMAL(18,2),
  "validation_status" TEXT NOT NULL DEFAULT 'PENDING',
  "validation_message" TEXT,
  "manual_approved_by_user_id" TEXT,
  "manual_approved_at" TIMESTAMP(3),
  "manual_approval_reason" TEXT,
  "split_contract" BOOLEAN NOT NULL DEFAULT false,
  "split_amount" DECIMAL(18,2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customs_declaration_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customs_declaration_documents_unique_file" ON "customs_declaration_documents"("customs_declaration_id", "document_type", "file_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_documents_customs_declaration_id_idx" ON "customs_declaration_documents"("customs_declaration_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_documents_document_type_idx" ON "customs_declaration_documents"("document_type");
CREATE INDEX IF NOT EXISTS "customs_declaration_documents_file_id_idx" ON "customs_declaration_documents"("file_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_documents_uploaded_by_user_id_idx" ON "customs_declaration_documents"("uploaded_by_user_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_documents_deleted_at_idx" ON "customs_declaration_documents"("deleted_at");

CREATE UNIQUE INDEX IF NOT EXISTS "customs_declaration_suppliers_unique_purchase" ON "customs_declaration_suppliers"("customs_declaration_id", "supplier_id", "purchase_order_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_suppliers_customs_declaration_id_idx" ON "customs_declaration_suppliers"("customs_declaration_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_suppliers_supplier_id_idx" ON "customs_declaration_suppliers"("supplier_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_suppliers_purchase_order_id_idx" ON "customs_declaration_suppliers"("purchase_order_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_suppliers_contract_file_id_idx" ON "customs_declaration_suppliers"("contract_file_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_suppliers_vat_invoice_file_id_idx" ON "customs_declaration_suppliers"("vat_invoice_file_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_suppliers_validation_status_idx" ON "customs_declaration_suppliers"("validation_status");
CREATE INDEX IF NOT EXISTS "customs_declaration_suppliers_manual_approved_by_user_id_idx" ON "customs_declaration_suppliers"("manual_approved_by_user_id");
CREATE INDEX IF NOT EXISTS "customs_declaration_suppliers_deleted_at_idx" ON "customs_declaration_suppliers"("deleted_at");

CREATE INDEX IF NOT EXISTS "customs_declarations_customer_id_idx" ON "customs_declarations"("customer_id");
CREATE INDEX IF NOT EXISTS "customs_declarations_batch_no_idx" ON "customs_declarations"("batch_no");
CREATE INDEX IF NOT EXISTS "customs_declarations_tax_record_id_idx" ON "customs_declarations"("tax_record_id");
CREATE INDEX IF NOT EXISTS "customs_declarations_declaration_amount_idx" ON "customs_declarations"("declaration_amount");
CREATE INDEX IF NOT EXISTS "customs_declarations_container_count_idx" ON "customs_declarations"("container_count");
CREATE INDEX IF NOT EXISTS "supplier_document_requests_customs_declaration_id_idx" ON "supplier_document_requests"("customs_declaration_id");
CREATE INDEX IF NOT EXISTS "supplier_document_requests_declaration_status_idx" ON "supplier_document_requests"("deleted_at", "customs_declaration_id", "supplier_id", "status");
CREATE INDEX IF NOT EXISTS "logistics_expenses_customs_declaration_id_idx" ON "logistics_expenses"("customs_declaration_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declarations_customer_id_fkey') THEN
    ALTER TABLE "customs_declarations" ADD CONSTRAINT "customs_declarations_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_document_requests_customs_declaration_id_fkey') THEN
    ALTER TABLE "supplier_document_requests" ADD CONSTRAINT "supplier_document_requests_customs_declaration_id_fkey"
      FOREIGN KEY ("customs_declaration_id") REFERENCES "customs_declarations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_customs_declaration_id_fkey') THEN
    ALTER TABLE "logistics_expenses" ADD CONSTRAINT "logistics_expenses_customs_declaration_id_fkey"
      FOREIGN KEY ("customs_declaration_id") REFERENCES "customs_declarations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_documents_customs_declaration_id_fkey') THEN
    ALTER TABLE "customs_declaration_documents" ADD CONSTRAINT "customs_declaration_documents_customs_declaration_id_fkey"
      FOREIGN KEY ("customs_declaration_id") REFERENCES "customs_declarations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_documents_file_id_fkey') THEN
    ALTER TABLE "customs_declaration_documents" ADD CONSTRAINT "customs_declaration_documents_file_id_fkey"
      FOREIGN KEY ("file_id") REFERENCES "order_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_documents_uploaded_by_user_id_fkey') THEN
    ALTER TABLE "customs_declaration_documents" ADD CONSTRAINT "customs_declaration_documents_uploaded_by_user_id_fkey"
      FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_suppliers_customs_declaration_id_fkey') THEN
    ALTER TABLE "customs_declaration_suppliers" ADD CONSTRAINT "customs_declaration_suppliers_customs_declaration_id_fkey"
      FOREIGN KEY ("customs_declaration_id") REFERENCES "customs_declarations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_suppliers_supplier_id_fkey') THEN
    ALTER TABLE "customs_declaration_suppliers" ADD CONSTRAINT "customs_declaration_suppliers_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_suppliers_purchase_order_id_fkey') THEN
    ALTER TABLE "customs_declaration_suppliers" ADD CONSTRAINT "customs_declaration_suppliers_purchase_order_id_fkey"
      FOREIGN KEY ("purchase_order_id") REFERENCES "order_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_suppliers_contract_file_id_fkey') THEN
    ALTER TABLE "customs_declaration_suppliers" ADD CONSTRAINT "customs_declaration_suppliers_contract_file_id_fkey"
      FOREIGN KEY ("contract_file_id") REFERENCES "order_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_suppliers_vat_invoice_file_id_fkey') THEN
    ALTER TABLE "customs_declaration_suppliers" ADD CONSTRAINT "customs_declaration_suppliers_vat_invoice_file_id_fkey"
      FOREIGN KEY ("vat_invoice_file_id") REFERENCES "order_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customs_declaration_suppliers_manual_approved_by_user_id_fkey') THEN
    ALTER TABLE "customs_declaration_suppliers" ADD CONSTRAINT "customs_declaration_suppliers_manual_approved_by_user_id_fkey"
      FOREIGN KEY ("manual_approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "customs_declarations" cd
SET "customer_id" = ro."customer_id"
FROM "receivable_orders" ro
WHERE cd."order_id" = ro."id"
  AND cd."customer_id" IS NULL;

WITH numbered AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "order_id" ORDER BY COALESCE("declaration_date", "created_at"), "created_at", "id") AS rn
  FROM "customs_declarations"
  WHERE "deleted_at" IS NULL
)
UPDATE "customs_declarations" cd
SET "batch_no" = '报关批次 ' || numbered.rn
FROM numbered
WHERE cd."id" = numbered."id"
  AND NULLIF(TRIM(COALESCE(cd."batch_no", '')), '') IS NULL;

INSERT INTO "customs_declaration_documents" (
  "id",
  "customs_declaration_id",
  "document_type",
  "file_id",
  "uploaded_by_user_id",
  "uploaded_at"
)
SELECT
  'cdd_' || md5(cd."id" || ':CUSTOMS_DECLARATION_FORM:' || od."id"),
  cd."id",
  'CUSTOMS_DECLARATION_FORM',
  od."id",
  od."uploaded_by",
  od."uploaded_at"
FROM "customs_declarations" cd
JOIN "order_documents" od ON od."id" = cd."pdf_document_id"
WHERE cd."deleted_at" IS NULL
  AND od."deleted_at" IS NULL
ON CONFLICT ("customs_declaration_id", "document_type", "file_id") DO NOTHING;

WITH default_declaration AS (
  SELECT DISTINCT ON ("order_id") "id", "order_id"
  FROM "customs_declarations"
  WHERE "deleted_at" IS NULL
  ORDER BY "order_id", COALESCE("declaration_date", "created_at"), "created_at", "id"
)
INSERT INTO "customs_declaration_documents" (
  "id",
  "customs_declaration_id",
  "document_type",
  "file_id",
  "uploaded_by_user_id",
  "uploaded_at"
)
SELECT
  'cdd_' || md5(dd."id" || ':' || od."document_type" || ':' || od."id"),
  dd."id",
  CASE od."document_type"
    WHEN 'CUSTOMS_ENTRY_FORM' THEN 'CUSTOMS_DECLARATION_FORM'
    WHEN 'RELEASE_NOTICE' THEN 'CUSTOMS_RELEASE_NOTICE'
    WHEN 'CUSTOMS_POWER_OF_ATTORNEY' THEN 'CUSTOMS_AUTHORIZATION'
    WHEN 'SUPPLIER_INVOICE' THEN 'SUPPLIER_VAT_INVOICE'
    ELSE od."document_type"::TEXT
  END,
  od."id",
  od."uploaded_by",
  od."uploaded_at"
FROM default_declaration dd
JOIN "order_documents" od ON od."order_id" = dd."order_id"
WHERE od."deleted_at" IS NULL
  AND od."upload_status" = 'SUCCESS'
  AND od."document_type" IN (
    'RELEASE_NOTICE',
    'CUSTOMS_POWER_OF_ATTORNEY',
    'PACKING_LIST',
    'COMMERCIAL_INVOICE',
    'SALES_CONTRACT',
    'SUPPLIER_PURCHASE_CONTRACT',
    'SUPPLIER_INVOICE'
  )
ON CONFLICT ("customs_declaration_id", "document_type", "file_id") DO NOTHING;

INSERT INTO "customs_declaration_suppliers" (
  "id",
  "customs_declaration_id",
  "supplier_id",
  "purchase_order_id",
  "required_invoice_amount",
  "validation_status"
)
SELECT
  'cds_' || md5(cd."id" || ':' || COALESCE(cd."supplier_id", oc."supplier_id", '') || ':' || COALESCE(cd."purchase_order_id", '')),
  cd."id",
  COALESCE(cd."supplier_id", oc."supplier_id"),
  cd."purchase_order_id",
  oc."amount",
  'PENDING'
FROM "customs_declarations" cd
LEFT JOIN "order_costs" oc ON oc."id" = cd."purchase_order_id"
WHERE cd."deleted_at" IS NULL
  AND COALESCE(cd."supplier_id", oc."supplier_id") IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "customs_declaration_suppliers" existing
    WHERE existing."customs_declaration_id" = cd."id"
      AND existing."supplier_id" = COALESCE(cd."supplier_id", oc."supplier_id")
      AND COALESCE(existing."purchase_order_id", '') = COALESCE(cd."purchase_order_id", '')
      AND existing."deleted_at" IS NULL
  )
ON CONFLICT ("id") DO NOTHING;

WITH request_declaration_candidates AS (
  SELECT
    r."id" AS request_id,
    cd."id" AS customs_declaration_id,
    oc."amount" AS required_invoice_amount,
    row_number() OVER (
      PARTITION BY r."id"
      ORDER BY
        CASE
          WHEN r."cost_id" IS NOT NULL AND cd."purchase_order_id" = r."cost_id" THEN 0
          WHEN r."cost_id" IS NOT NULL AND EXISTS (
            SELECT 1
            FROM "customs_declaration_suppliers" cds
            WHERE cds."customs_declaration_id" = cd."id"
              AND cds."deleted_at" IS NULL
              AND cds."purchase_order_id" = r."cost_id"
          ) THEN 1
          WHEN r."cost_id" IS NULL AND cd."supplier_id" = r."supplier_id" THEN 2
          ELSE 3
        END,
        cd."created_at"
    ) AS rn,
    count(*) OVER (PARTITION BY r."id") AS candidate_count
  FROM "supplier_document_requests" r
  JOIN "customs_declarations" cd ON cd."order_id" = r."order_id" AND cd."deleted_at" IS NULL
  LEFT JOIN "order_costs" oc ON oc."id" = r."cost_id"
  WHERE r."deleted_at" IS NULL
    AND r."customs_declaration_id" IS NULL
    AND (
      (
        r."cost_id" IS NOT NULL
        AND (
          cd."purchase_order_id" = r."cost_id"
          OR EXISTS (
            SELECT 1
            FROM "customs_declaration_suppliers" cds
            WHERE cds."customs_declaration_id" = cd."id"
              AND cds."deleted_at" IS NULL
              AND cds."purchase_order_id" = r."cost_id"
          )
        )
      )
      OR (
        r."cost_id" IS NULL
        AND (
          cd."supplier_id" = r."supplier_id"
          OR EXISTS (
            SELECT 1
            FROM "customs_declaration_suppliers" cds
            WHERE cds."customs_declaration_id" = cd."id"
              AND cds."deleted_at" IS NULL
              AND cds."supplier_id" = r."supplier_id"
          )
        )
      )
    )
),
candidate_request_declaration AS (
  SELECT DISTINCT ON (r."id")
    r."id" AS request_id,
    c."customs_declaration_id",
    c."required_invoice_amount"
  FROM "supplier_document_requests" r
  JOIN request_declaration_candidates c ON c.request_id = r."id"
  WHERE c.rn = 1
    AND c.candidate_count = 1
  ORDER BY r."id"
)
UPDATE "supplier_document_requests" r
SET
  "customs_declaration_id" = c."customs_declaration_id",
  "required_invoice_amount" = COALESCE(r."required_invoice_amount", c."required_invoice_amount")
FROM candidate_request_declaration c
WHERE r."id" = c.request_id;

INSERT INTO "customs_declaration_suppliers" (
  "id",
  "customs_declaration_id",
  "supplier_id",
  "purchase_order_id",
  "required_invoice_amount",
  "validation_status"
)
SELECT
  'cds_' || md5(r."customs_declaration_id" || ':' || r."supplier_id" || ':' || COALESCE(r."cost_id", '')),
  r."customs_declaration_id",
  r."supplier_id",
  r."cost_id",
  COALESCE(r."required_invoice_amount", oc."amount"),
  'PENDING'
FROM "supplier_document_requests" r
LEFT JOIN "order_costs" oc ON oc."id" = r."cost_id"
WHERE r."deleted_at" IS NULL
  AND r."customs_declaration_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "customs_declaration_suppliers" existing
    WHERE existing."customs_declaration_id" = r."customs_declaration_id"
      AND existing."supplier_id" = r."supplier_id"
      AND COALESCE(existing."purchase_order_id", '') = COALESCE(r."cost_id", '')
      AND existing."deleted_at" IS NULL
  )
ON CONFLICT ("id") DO NOTHING;

UPDATE "customs_declaration_suppliers" cds
SET
  "contract_file_id" = doc."id",
  "updated_at" = now()
FROM "order_documents" doc
JOIN "supplier_document_requests" r ON r."id" = doc."factory_document_request_id"
WHERE cds."customs_declaration_id" = r."customs_declaration_id"
  AND cds."supplier_id" = r."supplier_id"
  AND COALESCE(cds."purchase_order_id", '') = COALESCE(r."cost_id", '')
  AND doc."deleted_at" IS NULL
  AND doc."upload_status" = 'SUCCESS'
  AND doc."document_type" = 'SUPPLIER_PURCHASE_CONTRACT'
  AND cds."contract_file_id" IS NULL;

UPDATE "customs_declaration_suppliers" cds
SET
  "vat_invoice_file_id" = doc."id",
  "updated_at" = now()
FROM "order_documents" doc
JOIN "supplier_document_requests" r ON r."id" = doc."factory_document_request_id"
WHERE cds."customs_declaration_id" = r."customs_declaration_id"
  AND cds."supplier_id" = r."supplier_id"
  AND COALESCE(cds."purchase_order_id", '') = COALESCE(r."cost_id", '')
  AND doc."deleted_at" IS NULL
  AND doc."upload_status" = 'SUCCESS'
  AND doc."document_type" = 'SUPPLIER_INVOICE'
  AND cds."vat_invoice_file_id" IS NULL;

UPDATE "customs_declaration_suppliers"
SET
  "validation_status" = CASE
    WHEN "manual_approved_at" IS NOT NULL THEN 'MANUAL_APPROVED'
    WHEN "contract_file_id" IS NOT NULL
      AND "vat_invoice_file_id" IS NOT NULL
      AND ("contract_amount" IS NULL OR "vat_invoice_amount" IS NULL)
      THEN 'PENDING'
    WHEN "contract_file_id" IS NOT NULL
      AND "vat_invoice_file_id" IS NOT NULL
      AND COALESCE(ABS(COALESCE("contract_amount", 0) - COALESCE("vat_invoice_amount", 0)), 0) <= 0.01
      AND ("required_invoice_amount" IS NULL OR ABS(COALESCE("required_invoice_amount", 0) - COALESCE("vat_invoice_amount", 0)) <= 0.01)
      THEN 'PASSED'
    WHEN "contract_file_id" IS NULL OR "vat_invoice_file_id" IS NULL THEN 'PENDING'
    ELSE 'AMOUNT_MISMATCH'
  END,
  "validation_message" = CASE
    WHEN "contract_file_id" IS NULL THEN '缺少供应商采购合同'
    WHEN "vat_invoice_file_id" IS NULL THEN '缺少供应商增值税发票'
    WHEN "contract_amount" IS NULL THEN '合同金额待识别或人工确认'
    WHEN "vat_invoice_amount" IS NULL THEN '发票金额待识别或人工确认'
    WHEN "required_invoice_amount" IS NOT NULL AND ABS(COALESCE("required_invoice_amount", 0) - COALESCE("vat_invoice_amount", 0)) > 0.01 THEN '发票金额与要求开票金额不一致'
    WHEN ABS(COALESCE("contract_amount", 0) - COALESCE("vat_invoice_amount", 0)) > 0.01 THEN '合同金额与发票金额不一致'
    ELSE NULL
  END
WHERE "deleted_at" IS NULL;

WITH duplicate_null_purchase AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "customs_declaration_id", "supplier_id"
      ORDER BY "created_at", "id"
    ) AS rn
  FROM "customs_declaration_suppliers"
  WHERE "purchase_order_id" IS NULL
    AND "deleted_at" IS NULL
)
UPDATE "customs_declaration_suppliers" cds
SET
  "deleted_at" = now(),
  "validation_status" = 'DUPLICATE_DELETED',
  "validation_message" = '迁移时发现同报关批次同供应商重复归属，已保留最早一条'
FROM duplicate_null_purchase dup
WHERE cds."id" = dup."id"
  AND dup.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "customs_declaration_suppliers_unique_supplier_null_purchase"
  ON "customs_declaration_suppliers"("customs_declaration_id", "supplier_id")
  WHERE "purchase_order_id" IS NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "supplier_document_requests_active_batch_unique"
  ON "supplier_document_requests"(
    "order_id",
    "supplier_id",
    COALESCE("cost_id", ''),
    COALESCE("customs_declaration_id", '')
  )
  WHERE "deleted_at" IS NULL AND "status" IN ('待上传', '部分上传');
