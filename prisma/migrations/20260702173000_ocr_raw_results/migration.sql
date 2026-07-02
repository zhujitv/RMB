CREATE TABLE IF NOT EXISTS "ocr_raw_results" (
  "id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "order_id" TEXT,
  "document_type" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'ALIYUN',
  "api_name" TEXT NOT NULL,
  "raw_json" JSONB,
  "parsed_json" JSONB,
  "confidence" DECIMAL(8,4),
  "status" TEXT NOT NULL DEFAULT 'SUCCESS',
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ocr_raw_results_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_raw_results_document_id_fkey'
  ) THEN
    ALTER TABLE "ocr_raw_results"
      ADD CONSTRAINT "ocr_raw_results_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "order_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ocr_raw_results_order_id_fkey'
  ) THEN
    ALTER TABLE "ocr_raw_results"
      ADD CONSTRAINT "ocr_raw_results_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ocr_raw_results_document_id_idx" ON "ocr_raw_results"("document_id");
CREATE INDEX IF NOT EXISTS "ocr_raw_results_order_id_idx" ON "ocr_raw_results"("order_id");
CREATE INDEX IF NOT EXISTS "ocr_raw_results_document_type_idx" ON "ocr_raw_results"("document_type");
CREATE INDEX IF NOT EXISTS "ocr_raw_results_provider_api_name_idx" ON "ocr_raw_results"("provider", "api_name");
CREATE INDEX IF NOT EXISTS "ocr_raw_results_status_idx" ON "ocr_raw_results"("status");

ALTER TABLE "export_customs_declaration_items" ADD COLUMN IF NOT EXISTS "specification" TEXT;
ALTER TABLE "export_customs_declaration_items" ADD COLUMN IF NOT EXISTS "unit_price" DECIMAL(18,6);
ALTER TABLE "export_customs_declaration_items" ADD COLUMN IF NOT EXISTS "total_amount" DECIMAL(18,2);
ALTER TABLE "export_customs_declaration_items" ADD COLUMN IF NOT EXISTS "gross_weight" DECIMAL(18,4);
ALTER TABLE "export_customs_declaration_items" ADD COLUMN IF NOT EXISTS "net_weight" DECIMAL(18,4);
ALTER TABLE "export_customs_declaration_items" ADD COLUMN IF NOT EXISTS "origin_country" TEXT;
ALTER TABLE "export_customs_declaration_items" ADD COLUMN IF NOT EXISTS "destination_country" TEXT;
