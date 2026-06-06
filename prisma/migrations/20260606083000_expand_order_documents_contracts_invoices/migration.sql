ALTER TYPE "OrderDocumentType" ADD VALUE IF NOT EXISTS 'SALES_CONTRACT';
ALTER TYPE "OrderDocumentType" ADD VALUE IF NOT EXISTS 'SUPPLIER_PURCHASE_CONTRACT';
ALTER TYPE "OrderDocumentType" ADD VALUE IF NOT EXISTS 'SUPPLIER_INVOICE';

ALTER TABLE "order_documents"
ADD COLUMN "cost_id" TEXT,
ADD COLUMN "supplier_id" TEXT,
ADD COLUMN "related_module" TEXT NOT NULL DEFAULT 'EXPORT';

CREATE INDEX "order_documents_cost_id_idx" ON "order_documents"("cost_id");
CREATE INDEX "order_documents_supplier_id_idx" ON "order_documents"("supplier_id");
CREATE INDEX "order_documents_related_module_idx" ON "order_documents"("related_module");

ALTER TABLE "order_documents"
ADD CONSTRAINT "order_documents_cost_id_fkey"
FOREIGN KEY ("cost_id") REFERENCES "order_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_documents"
ADD CONSTRAINT "order_documents_supplier_id_fkey"
FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
