ALTER TABLE "domestic_logistics_infos"
  ADD COLUMN IF NOT EXISTS "customs_export_invoice" JSONB;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'domestic_logistics_infos'
      AND column_name = 'export_invoice_remark'
  ) THEN
    UPDATE "domestic_logistics_infos"
    SET "customs_export_invoice" = jsonb_build_object('remark', "export_invoice_remark")
    WHERE "customs_export_invoice" IS NULL
      AND "export_invoice_remark" IS NOT NULL;

    ALTER TABLE "domestic_logistics_infos"
      DROP COLUMN IF EXISTS "export_invoice_remark";
  END IF;
END $$;
