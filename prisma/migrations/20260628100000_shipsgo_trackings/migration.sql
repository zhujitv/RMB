CREATE TABLE IF NOT EXISTS "shipsgo_trackings" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'SHIPSGO',
  "mode" TEXT NOT NULL DEFAULT 'OCEAN',
  "shipsgo_shipment_id" TEXT,
  "reference" TEXT,
  "carrier_scac" TEXT,
  "carrier_name" TEXT,
  "booking_number" TEXT,
  "container_number" TEXT,
  "status" TEXT NOT NULL DEFAULT 'LOCAL_PENDING',
  "sync_status" TEXT NOT NULL DEFAULT 'NOT_SYNCED',
  "sync_message" TEXT,
  "origin_name" TEXT,
  "destination_name" TEXT,
  "date_of_loading" TIMESTAMP(3),
  "date_of_discharge" TIMESTAMP(3),
  "predicted_discharge_date" TIMESTAMP(3),
  "vessel_name" TEXT,
  "voyage" TEXT,
  "map_token" TEXT,
  "map_url" TEXT,
  "last_event" TEXT,
  "last_event_at" TIMESTAMP(3),
  "last_checked_at" TIMESTAMP(3),
  "last_synced_at" TIMESTAMP(3),
  "raw_payload" JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "shipsgo_trackings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "shipsgo_trackings_order_id_idx" ON "shipsgo_trackings"("order_id");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_provider_idx" ON "shipsgo_trackings"("provider");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_mode_idx" ON "shipsgo_trackings"("mode");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_shipsgo_shipment_id_idx" ON "shipsgo_trackings"("shipsgo_shipment_id");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_booking_number_idx" ON "shipsgo_trackings"("booking_number");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_container_number_idx" ON "shipsgo_trackings"("container_number");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_status_idx" ON "shipsgo_trackings"("status");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_sync_status_idx" ON "shipsgo_trackings"("sync_status");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_last_synced_at_idx" ON "shipsgo_trackings"("last_synced_at");
CREATE INDEX IF NOT EXISTS "shipsgo_trackings_deleted_at_idx" ON "shipsgo_trackings"("deleted_at");
CREATE UNIQUE INDEX IF NOT EXISTS "shipsgo_trackings_provider_shipment_unique"
  ON "shipsgo_trackings"("provider", "shipsgo_shipment_id")
  WHERE "shipsgo_shipment_id" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipsgo_trackings_order_id_fkey') THEN
    ALTER TABLE "shipsgo_trackings"
      ADD CONSTRAINT "shipsgo_trackings_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipsgo_trackings_created_by_fkey') THEN
    ALTER TABLE "shipsgo_trackings"
      ADD CONSTRAINT "shipsgo_trackings_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipsgo_trackings_updated_by_fkey') THEN
    ALTER TABLE "shipsgo_trackings"
      ADD CONSTRAINT "shipsgo_trackings_updated_by_fkey"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
