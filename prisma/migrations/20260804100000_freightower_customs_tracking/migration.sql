ALTER TABLE "shipsgo_trackings"
  ADD COLUMN "customs_tracking_status" TEXT NOT NULL DEFAULT 'DISABLED',
  ADD COLUMN "customs_tracking_message" TEXT,
  ADD COLUMN "customs_direction" TEXT,
  ADD COLUMN "customs_last_checked_at" TIMESTAMP(3),
  ADD COLUMN "customs_last_synced_at" TIMESTAMP(3),
  ADD COLUMN "customs_notification_baseline_at" TIMESTAMP(3),
  ADD COLUMN "customs_raw_response" JSONB;

-- Existing rows are history backfills and must not emit a first-sync message.
-- Rows created after this migration keep NULL until their first customs query.
UPDATE "shipsgo_trackings"
SET "customs_notification_baseline_at" = CURRENT_TIMESTAMP;

CREATE INDEX "shipsgo_trackings_customs_tracking_status_idx"
  ON "shipsgo_trackings"("customs_tracking_status");
