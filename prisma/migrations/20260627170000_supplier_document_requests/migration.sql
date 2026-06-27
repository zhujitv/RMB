ALTER TABLE "suppliers"
ADD COLUMN IF NOT EXISTS "allow_factory_document_upload" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "suppliers_allow_factory_document_upload_idx"
ON "suppliers"("allow_factory_document_upload");

CREATE TABLE IF NOT EXISTS "supplier_document_requests" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "requested_by" TEXT,
  "required_document_types" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT '待上传',
  "due_date" DATE,
  "message" TEXT,
  "template_file_name" TEXT,
  "template_original_name" TEXT,
  "template_mime_type" TEXT,
  "template_file_size" INTEGER,
  "template_storage_key" TEXT,
  "template_bucket" TEXT,
  "recipient_emails" JSONB,
  "cc_emails" JSONB,
  "send_status" TEXT NOT NULL DEFAULT 'pending',
  "send_error" TEXT,
  "email_subject" TEXT,
  "email_body" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "supplier_document_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_document_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplier_document_requests_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_document_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "supplier_document_requests_order_id_idx"
ON "supplier_document_requests"("order_id");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_supplier_id_idx"
ON "supplier_document_requests"("supplier_id");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_requested_by_idx"
ON "supplier_document_requests"("requested_by");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_status_idx"
ON "supplier_document_requests"("status");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_send_status_idx"
ON "supplier_document_requests"("send_status");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_due_date_idx"
ON "supplier_document_requests"("due_date");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_deleted_at_idx"
ON "supplier_document_requests"("deleted_at");

ALTER TABLE "order_documents"
ADD COLUMN IF NOT EXISTS "factory_document_request_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_documents_factory_document_request_id_fkey'
  ) THEN
    ALTER TABLE "order_documents"
    ADD CONSTRAINT "order_documents_factory_document_request_id_fkey"
    FOREIGN KEY ("factory_document_request_id") REFERENCES "supplier_document_requests"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "order_documents_factory_document_request_id_idx"
ON "order_documents"("factory_document_request_id");
