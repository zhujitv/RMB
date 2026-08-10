ALTER TABLE "shipsgo_trackings"
  ADD COLUMN "sync_lease_token" TEXT,
  ADD COLUMN "sync_lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "tracking_notification_pending_at" TIMESTAMP(3),
  ADD COLUMN "tracking_notification_pending_mask" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tracking_notification_queued_key" TEXT;

CREATE INDEX "shipsgo_trackings_sync_lease_expires_at_idx"
  ON "shipsgo_trackings"("sync_lease_expires_at");

CREATE INDEX "shipsgo_trackings_tracking_notification_pending_at_idx"
  ON "shipsgo_trackings"("tracking_notification_pending_at");

-- Soft-deleted provider rows must not prevent a legitimate re-creation of the
-- same shipment. Active rows remain unique across orders.
DROP INDEX IF EXISTS "shipsgo_trackings_provider_shipment_unique";
CREATE UNIQUE INDEX "shipsgo_trackings_provider_shipment_unique"
  ON "shipsgo_trackings"("provider", "shipsgo_shipment_id")
  WHERE "shipsgo_shipment_id" IS NOT NULL AND "deleted_at" IS NULL;
