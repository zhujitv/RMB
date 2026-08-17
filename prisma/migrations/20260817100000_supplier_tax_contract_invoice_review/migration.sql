BEGIN;

ALTER TABLE "business_entities"
  ADD COLUMN IF NOT EXISTS "tax_number" TEXT;

ALTER TABLE "supplier_document_requests"
  ADD COLUMN IF NOT EXISTS "contract_no" TEXT,
  ADD COLUMN IF NOT EXISTS "contract_status" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS "contract_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "contract_draft" JSONB,
  ADD COLUMN IF NOT EXISTS "contract_approved" JSONB,
  ADD COLUMN IF NOT EXISTS "contract_generated_by" TEXT,
  ADD COLUMN IF NOT EXISTS "contract_generated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "contract_reviewed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "contract_reviewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "contract_review_remark" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_match_status" TEXT NOT NULL DEFAULT 'NOT_UPLOADED',
  ADD COLUMN IF NOT EXISTS "invoice_match_json" JSONB,
  ADD COLUMN IF NOT EXISTS "invoice_no" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_ocr_task_id" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_confirmed_by" TEXT,
  ADD COLUMN IF NOT EXISTS "invoice_confirmed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invoice_reject_reason" TEXT;

ALTER TABLE "supplier_document_requests"
  ADD CONSTRAINT "supplier_document_requests_contract_generated_by_fkey"
  FOREIGN KEY ("contract_generated_by") REFERENCES "users"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "supplier_document_requests_contract_reviewed_by_fkey"
  FOREIGN KEY ("contract_reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "supplier_document_requests_invoice_confirmed_by_fkey"
  FOREIGN KEY ("invoice_confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "supplier_document_requests_contract_no_idx"
  ON "supplier_document_requests"("contract_no");
CREATE INDEX IF NOT EXISTS "supplier_document_requests_contract_status_idx"
  ON "supplier_document_requests"("contract_status");
CREATE INDEX IF NOT EXISTS "supplier_document_requests_invoice_match_status_idx"
  ON "supplier_document_requests"("invoice_match_status");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_document_requests_active_invoice_no_unique"
  ON "supplier_document_requests"("invoice_no")
  WHERE "deleted_at" IS NULL AND "invoice_no" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "supplier_document_requests_invoice_ocr_task_id_idx"
  ON "supplier_document_requests"("invoice_ocr_task_id");

ALTER TABLE "supplier_document_requests"
  ADD CONSTRAINT "supplier_document_requests_contract_revision_positive"
  CHECK ("contract_revision" > 0),
  ADD CONSTRAINT "supplier_document_requests_contract_status_valid"
  CHECK ("contract_status" IN ('LEGACY', 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  ADD CONSTRAINT "supplier_document_requests_invoice_match_status_valid"
  CHECK ("invoice_match_status" IN ('NOT_UPLOADED', 'PROCESSING', 'MISMATCH', 'AWAITING_REVIEW', 'CONFIRMED', 'REJECTED', 'FAILED'));

COMMIT;
