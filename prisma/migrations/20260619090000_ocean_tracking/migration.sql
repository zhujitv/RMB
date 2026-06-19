ALTER TABLE "domestic_logistics_infos"
  ADD COLUMN IF NOT EXISTS "ocean_carrier" TEXT,
  ADD COLUMN IF NOT EXISTS "ocean_bl_no" TEXT,
  ADD COLUMN IF NOT EXISTS "ocean_container_no" TEXT,
  ADD COLUMN IF NOT EXISTS "vessel_voyage" TEXT,
  ADD COLUMN IF NOT EXISTS "ocean_tracking_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ocean_tracking_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "ocean_tracking_status" TEXT,
  ADD COLUMN IF NOT EXISTS "ocean_tracking_message" TEXT,
  ADD COLUMN IF NOT EXISTS "ocean_tracking_eta" DATE,
  ADD COLUMN IF NOT EXISTS "ocean_tracking_events" JSONB,
  ADD COLUMN IF NOT EXISTS "ocean_tracking_last_checked_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ocean_tracking_last_success_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_ocean_tracking_enabled_idx"
  ON "domestic_logistics_infos"("ocean_tracking_enabled");

CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_ocean_tracking_status_idx"
  ON "domestic_logistics_infos"("ocean_tracking_status");

CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_ocean_tracking_last_checked_at_idx"
  ON "domestic_logistics_infos"("ocean_tracking_last_checked_at");
