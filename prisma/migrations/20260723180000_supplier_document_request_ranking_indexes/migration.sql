CREATE INDEX IF NOT EXISTS "supplier_document_requests_rank_created_id_idx"
ON "supplier_document_requests"("deleted_at", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "supplier_document_requests_supplier_rank_created_id_idx"
ON "supplier_document_requests"("deleted_at", "supplier_id", "created_at" DESC, "id" DESC);
