ALTER TABLE "suppliers"
ADD COLUMN IF NOT EXISTS "is_default_logistics_supplier" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "suppliers_is_default_logistics_supplier_idx"
ON "suppliers"("is_default_logistics_supplier");
