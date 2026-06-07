DO $$ BEGIN
  CREATE TYPE "DomesticLogisticsDocumentCategory" AS ENUM (
    'CUSTOMS_DECLARATION',
    'CUSTOMS_RELEASE_NOTICE',
    'CUSTOMS_POWER_OF_ATTORNEY',
    'CUSTOMS_FEE_INVOICE',
    'TRUCKING_FEE_INVOICE',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "domestic_logistics_documents" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "document_category" "DomesticLogisticsDocumentCategory" NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "file_type" TEXT NOT NULL,
  "uploaded_by" TEXT,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'UPLOADED',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domestic_logistics_documents_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "domestic_logistics_documents"
    ADD CONSTRAINT "domestic_logistics_documents_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "domestic_logistics_documents"
    ADD CONSTRAINT "domestic_logistics_documents_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "domestic_logistics_documents_order_id_idx" ON "domestic_logistics_documents"("order_id");
CREATE INDEX IF NOT EXISTS "domestic_logistics_documents_document_category_idx" ON "domestic_logistics_documents"("document_category");
CREATE INDEX IF NOT EXISTS "domestic_logistics_documents_status_idx" ON "domestic_logistics_documents"("status");
CREATE INDEX IF NOT EXISTS "domestic_logistics_documents_uploaded_at_idx" ON "domestic_logistics_documents"("uploaded_at");
