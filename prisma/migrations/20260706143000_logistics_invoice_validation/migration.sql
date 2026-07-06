ALTER TABLE "logistics_expenses"
  ADD COLUMN IF NOT EXISTS "invoice_validation_status" TEXT NOT NULL DEFAULT '未上传',
  ADD COLUMN IF NOT EXISTS "invoice_validation_message" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_validation_json" JSONB,
  ADD COLUMN IF NOT EXISTS "invoice_ocr_task_id" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_recognized_no" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_recognized_date" DATE,
  ADD COLUMN IF NOT EXISTS "invoice_recognized_seller" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_recognized_buyer" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_recognized_amount" DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS "invoice_recognized_name" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_manual_confirmed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_manual_confirmed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invoice_manual_confirm_reason" TEXT;

CREATE INDEX IF NOT EXISTS "logistics_expenses_invoice_validation_status_idx" ON "logistics_expenses"("invoice_validation_status");
CREATE INDEX IF NOT EXISTS "logistics_expenses_invoice_ocr_task_id_idx" ON "logistics_expenses"("invoice_ocr_task_id");
