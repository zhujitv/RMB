-- Revert the multi-customs-declaration batch ownership rollout.
-- Original order, document, supplier document request, cost, and logistics rows remain intact.

ALTER TABLE "supplier_document_requests"
  DROP CONSTRAINT IF EXISTS "supplier_document_requests_customs_declaration_id_fkey";

ALTER TABLE "logistics_expenses"
  DROP CONSTRAINT IF EXISTS "logistics_expenses_customs_declaration_id_fkey";

DROP TABLE IF EXISTS "customs_declaration_suppliers" CASCADE;
DROP TABLE IF EXISTS "customs_declaration_documents" CASCADE;
DROP TABLE IF EXISTS "customs_declarations" CASCADE;

ALTER TABLE "supplier_document_requests"
  DROP COLUMN IF EXISTS "customs_declaration_id",
  DROP COLUMN IF EXISTS "required_invoice_amount";

ALTER TABLE "logistics_expenses"
  DROP COLUMN IF EXISTS "customs_declaration_id",
  DROP COLUMN IF EXISTS "allocation_method",
  DROP COLUMN IF EXISTS "allocated_amount";
