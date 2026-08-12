BEGIN;

ALTER TABLE "business_entities"
  ADD COLUMN "name_en" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "contact_email" TEXT,
  ADD COLUMN "contact_phone" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "bank_account" TEXT;

ALTER TABLE "sales_quotation_versions"
  ADD COLUMN "seller_bank_account_snapshot" TEXT;

ALTER TABLE "file_assets"
  ADD COLUMN "content_sha256" TEXT;

UPDATE "sales_quotations" AS quotation
SET "business_entity_id" = selected_entity."id"
FROM (
  SELECT "id"
  FROM "business_entities"
  WHERE "is_default" = TRUE
    AND "deleted_at" IS NULL
  ORDER BY "sort_order" ASC, "created_at" ASC
  LIMIT 1
) AS selected_entity
WHERE quotation."business_entity_id" IS NULL;

ALTER TABLE "file_assets"
  ADD CONSTRAINT "file_assets_content_sha256_check"
  CHECK ("content_sha256" IS NULL OR "content_sha256" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "sales_quotation_versions_id_quotation_id_key"
  ON "sales_quotation_versions"("id", "quotation_id");

ALTER TABLE "sales_quotation_deliveries"
  DROP CONSTRAINT "sales_quotation_deliveries_quotation_version_id_fkey";

ALTER TABLE "sales_quotation_deliveries"
  ADD CONSTRAINT "sales_quotation_deliveries_quotation_version_id_quotation_id_fkey"
  FOREIGN KEY ("quotation_version_id", "quotation_id")
  REFERENCES "sales_quotation_versions"("id", "quotation_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
