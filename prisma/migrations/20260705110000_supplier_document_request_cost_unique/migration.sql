CREATE UNIQUE INDEX IF NOT EXISTS "supplier_document_requests_active_cost_unique"
ON "supplier_document_requests"("cost_id")
WHERE "cost_id" IS NOT NULL
  AND "deleted_at" IS NULL
  AND "status" <> 'DELETED';
