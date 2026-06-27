ALTER TABLE "shipsgo_trackings"
  ADD COLUMN IF NOT EXISTS "raw_response" JSONB;

UPDATE "shipsgo_trackings"
SET "raw_response" = "raw_payload"
WHERE "raw_response" IS NULL AND "raw_payload" IS NOT NULL;
