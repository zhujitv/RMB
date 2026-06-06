CREATE TYPE "OrderDocumentType" AS ENUM (
  'CUSTOMS_ENTRY_FORM',
  'RELEASE_NOTICE',
  'CUSTOMS_POWER_OF_ATTORNEY',
  'BILL_OF_LADING',
  'COMMERCIAL_INVOICE',
  'PACKING_LIST'
);

CREATE TYPE "UploadStatus" AS ENUM (
  'PENDING',
  'UPLOADING',
  'SUCCESS',
  'FAILED'
);

ALTER TABLE "receivable_orders"
ADD COLUMN "tax_refund_status" TEXT NOT NULL DEFAULT 'NOT_READY';

CREATE TABLE "order_documents" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "document_type" "OrderDocumentType" NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "mime_type" TEXT NOT NULL,
  "r2_bucket" TEXT NOT NULL,
  "r2_key" TEXT NOT NULL,
  "file_url" TEXT,
  "upload_status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
  "upload_progress" INTEGER NOT NULL DEFAULT 0,
  "uploaded_by" TEXT,
  "uploaded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "order_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receivable_orders_tax_refund_status_idx" ON "receivable_orders"("tax_refund_status");
CREATE INDEX "order_documents_order_id_idx" ON "order_documents"("order_id");
CREATE INDEX "order_documents_document_type_idx" ON "order_documents"("document_type");
CREATE INDEX "order_documents_upload_status_idx" ON "order_documents"("upload_status");
CREATE INDEX "order_documents_uploaded_by_idx" ON "order_documents"("uploaded_by");
CREATE INDEX "order_documents_deleted_at_idx" ON "order_documents"("deleted_at");

ALTER TABLE "order_documents"
ADD CONSTRAINT "order_documents_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_documents"
ADD CONSTRAINT "order_documents_uploaded_by_fkey"
FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
