CREATE TABLE IF NOT EXISTS "ocean_carriers" (
  "id" TEXT NOT NULL,
  "carrier_name" TEXT NOT NULL,
  "scac_code" TEXT,
  "aliases" JSONB,
  "website" TEXT,
  "tracking_url" TEXT,
  "status" TEXT NOT NULL DEFAULT '启用',
  "remark" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "ocean_carriers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ocean_carriers_carrier_name_idx" ON "ocean_carriers"("carrier_name");
CREATE INDEX IF NOT EXISTS "ocean_carriers_scac_code_idx" ON "ocean_carriers"("scac_code");
CREATE INDEX IF NOT EXISTS "ocean_carriers_status_idx" ON "ocean_carriers"("status");
CREATE INDEX IF NOT EXISTS "ocean_carriers_deleted_at_idx" ON "ocean_carriers"("deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ocean_carriers_created_by_fkey') THEN
    ALTER TABLE "ocean_carriers"
      ADD CONSTRAINT "ocean_carriers_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ocean_carriers_updated_by_fkey') THEN
    ALTER TABLE "ocean_carriers"
      ADD CONSTRAINT "ocean_carriers_updated_by_fkey"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
