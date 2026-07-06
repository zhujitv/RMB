ALTER TABLE "supplier_document_requests"
ADD COLUMN IF NOT EXISTS "purchase_order_no" TEXT;

UPDATE "supplier_document_requests" request
SET "purchase_order_no" = orders."order_no"
FROM "receivable_orders" orders
WHERE request."order_id" = orders."id"
  AND (request."purchase_order_no" IS NULL OR btrim(request."purchase_order_no") = '');

CREATE INDEX IF NOT EXISTS "supplier_document_requests_purchase_order_no_idx"
ON "supplier_document_requests"("purchase_order_no");

CREATE INDEX IF NOT EXISTS "supplier_document_requests_created_at_idx"
ON "supplier_document_requests"("created_at");

CREATE INDEX IF NOT EXISTS "order_documents_factory_request_deleted_idx"
ON "order_documents"("factory_document_request_id", "deleted_at");
