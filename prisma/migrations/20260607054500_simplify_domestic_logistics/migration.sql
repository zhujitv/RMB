-- Simplify domestic logistics info to tax-required transport facts only.
ALTER TABLE "domestic_logistics_infos"
  DROP CONSTRAINT IF EXISTS "domestic_logistics_infos_responsible_supplier_id_fkey";

DROP INDEX IF EXISTS "domestic_logistics_infos_responsible_supplier_id_idx";

ALTER TABLE "domestic_logistics_infos"
  DROP COLUMN IF EXISTS "responsible_supplier_id",
  DROP COLUMN IF EXISTS "temporary_supplier_name";
