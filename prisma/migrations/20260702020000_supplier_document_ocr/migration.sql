CREATE TABLE IF NOT EXISTS "ocr_tasks" (
  "id" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "request_id" TEXT,
  "order_id" TEXT,
  "supplier_id" TEXT,
  "document_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OCR识别中',
  "validation_status" TEXT,
  "error_message" TEXT,
  "raw_text" TEXT,
  "result_json" JSONB,
  "validation_json" JSONB,
  "confirmed_by_id" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "rejected_by_id" TEXT,
  "rejected_at" TIMESTAMP(3),
  "reject_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ocr_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ocr_results" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "field_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "value" TEXT,
  "raw_value" TEXT,
  "confidence" DECIMAL(8,4),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ocr_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ocr_tasks_module_idx" ON "ocr_tasks"("module");
CREATE INDEX IF NOT EXISTS "ocr_tasks_document_id_idx" ON "ocr_tasks"("document_id");
CREATE INDEX IF NOT EXISTS "ocr_tasks_request_id_idx" ON "ocr_tasks"("request_id");
CREATE INDEX IF NOT EXISTS "ocr_tasks_order_id_idx" ON "ocr_tasks"("order_id");
CREATE INDEX IF NOT EXISTS "ocr_tasks_supplier_id_idx" ON "ocr_tasks"("supplier_id");
CREATE INDEX IF NOT EXISTS "ocr_tasks_status_idx" ON "ocr_tasks"("status");
CREATE INDEX IF NOT EXISTS "ocr_tasks_validation_status_idx" ON "ocr_tasks"("validation_status");
CREATE INDEX IF NOT EXISTS "ocr_tasks_document_type_idx" ON "ocr_tasks"("document_type");
CREATE INDEX IF NOT EXISTS "ocr_results_task_id_idx" ON "ocr_results"("task_id");
CREATE INDEX IF NOT EXISTS "ocr_results_field_key_idx" ON "ocr_results"("field_key");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_tasks_document_id_fkey'
  ) THEN
    ALTER TABLE "ocr_tasks"
      ADD CONSTRAINT "ocr_tasks_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "order_documents"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_tasks_request_id_fkey'
  ) THEN
    ALTER TABLE "ocr_tasks"
      ADD CONSTRAINT "ocr_tasks_request_id_fkey"
      FOREIGN KEY ("request_id") REFERENCES "supplier_document_requests"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_tasks_order_id_fkey'
  ) THEN
    ALTER TABLE "ocr_tasks"
      ADD CONSTRAINT "ocr_tasks_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_tasks_supplier_id_fkey'
  ) THEN
    ALTER TABLE "ocr_tasks"
      ADD CONSTRAINT "ocr_tasks_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_tasks_confirmed_by_id_fkey'
  ) THEN
    ALTER TABLE "ocr_tasks"
      ADD CONSTRAINT "ocr_tasks_confirmed_by_id_fkey"
      FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_tasks_rejected_by_id_fkey'
  ) THEN
    ALTER TABLE "ocr_tasks"
      ADD CONSTRAINT "ocr_tasks_rejected_by_id_fkey"
      FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_results_task_id_fkey'
  ) THEN
    ALTER TABLE "ocr_results"
      ADD CONSTRAINT "ocr_results_task_id_fkey"
      FOREIGN KEY ("task_id") REFERENCES "ocr_tasks"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
