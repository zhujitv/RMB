DROP INDEX IF EXISTS "domestic_logistics_infos_ocean_tracking_last_checked_at_idx";
DROP INDEX IF EXISTS "domestic_logistics_infos_ocean_tracking_status_idx";
DROP INDEX IF EXISTS "domestic_logistics_infos_ocean_tracking_enabled_idx";

ALTER TABLE "domestic_logistics_infos"
  DROP COLUMN IF EXISTS "ocean_carrier",
  DROP COLUMN IF EXISTS "ocean_bl_no",
  DROP COLUMN IF EXISTS "ocean_container_no",
  DROP COLUMN IF EXISTS "vessel_voyage",
  DROP COLUMN IF EXISTS "ocean_tracking_enabled",
  DROP COLUMN IF EXISTS "ocean_tracking_provider",
  DROP COLUMN IF EXISTS "ocean_tracking_status",
  DROP COLUMN IF EXISTS "ocean_tracking_message",
  DROP COLUMN IF EXISTS "ocean_tracking_eta",
  DROP COLUMN IF EXISTS "ocean_tracking_events",
  DROP COLUMN IF EXISTS "ocean_tracking_last_checked_at",
  DROP COLUMN IF EXISTS "ocean_tracking_last_success_at";

DROP TABLE IF EXISTS "ocean_carriers";
