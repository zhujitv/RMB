ALTER TABLE "shipsgo_trackings"
  ADD COLUMN IF NOT EXISTS "master_bl_no" TEXT,
  ADD COLUMN IF NOT EXISTS "current_status" TEXT,
  ADD COLUMN IF NOT EXISTS "eta" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_sync_time" TIMESTAMP(3);

UPDATE "shipsgo_trackings"
SET
  "master_bl_no" = COALESCE("master_bl_no", "booking_number"),
  "current_status" = COALESCE("current_status", "status"),
  "eta" = COALESCE("eta", "predicted_discharge_date", "date_of_discharge"),
  "last_sync_time" = COALESCE("last_sync_time", "last_synced_at")
WHERE
  "master_bl_no" IS NULL
  OR "current_status" IS NULL
  OR "eta" IS NULL
  OR "last_sync_time" IS NULL;

CREATE TABLE IF NOT EXISTS "shipsgo_tracking_containers" (
  "id" TEXT NOT NULL,
  "tracking_id" TEXT NOT NULL,
  "container_no" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipsgo_tracking_containers_pkey" PRIMARY KEY ("id")
);

INSERT INTO "shipsgo_tracking_containers" ("id", "tracking_id", "container_no")
SELECT
  'sgtc_' || md5("id" || ':' || upper(trim("container_number"))),
  "id",
  upper(trim("container_number"))
FROM "shipsgo_trackings"
WHERE
  "container_number" IS NOT NULL
  AND trim("container_number") <> ''
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS "shipsgo_trackings_master_bl_no_idx" ON "shipsgo_trackings"("master_bl_no");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_current_status_idx" ON "shipsgo_trackings"("current_status");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_last_sync_time_idx" ON "shipsgo_trackings"("last_sync_time");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_order_provider_mode_deleted_idx"
  ON "shipsgo_trackings"("order_id", "provider", "mode", "deleted_at");
CREATE INDEX IF NOT EXISTS "shipsgo_tracking_containers_tracking_id_idx" ON "shipsgo_tracking_containers"("tracking_id");
CREATE INDEX IF NOT EXISTS "shipsgo_tracking_containers_container_no_idx" ON "shipsgo_tracking_containers"("container_no");
CREATE UNIQUE INDEX IF NOT EXISTS "shipsgo_tracking_containers_tracking_container_unique"
  ON "shipsgo_tracking_containers"("tracking_id", "container_no");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipsgo_tracking_containers_tracking_id_fkey') THEN
    ALTER TABLE "shipsgo_tracking_containers"
      ADD CONSTRAINT "shipsgo_tracking_containers_tracking_id_fkey"
      FOREIGN KEY ("tracking_id") REFERENCES "shipsgo_trackings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
