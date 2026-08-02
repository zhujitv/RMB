ALTER TABLE "shipsgo_trackings"
  ADD COLUMN "port_tracking_status" TEXT NOT NULL DEFAULT 'NOT_SUBSCRIBED',
  ADD COLUMN "port_tracking_message" TEXT,
  ADD COLUMN "port_subscription_id" TEXT,
  ADD COLUMN "port_code" TEXT,
  ADD COLUMN "port_direction" TEXT,
  ADD COLUMN "port_last_checked_at" TIMESTAMP(3),
  ADD COLUMN "port_last_synced_at" TIMESTAMP(3),
  ADD COLUMN "port_raw_response" JSONB;

CREATE INDEX "shipsgo_trackings_port_tracking_status_idx"
  ON "shipsgo_trackings"("port_tracking_status");

CREATE INDEX "shipsgo_trackings_port_subscription_id_idx"
  ON "shipsgo_trackings"("port_subscription_id");
