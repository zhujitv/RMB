-- China customs tracking now uses the same direct API Key as comprehensive tracking.
-- Enable the feature for the existing encrypted JSON settings object without touching
-- any encrypted credential fields.
UPDATE "system_settings"
SET
  "value" = jsonb_set("value", '{customsTrackingEnabled}', 'true'::jsonb, true),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'shipsgo_integration';

ALTER TABLE "shipsgo_trackings"
  ALTER COLUMN "customs_tracking_status" SET DEFAULT 'NOT_QUERIED';

-- Existing active rows were disabled only because Token credentials were unavailable.
-- Put them back into the normal sync queue; the scheduled worker will query them with
-- the already configured API Key. Preserve the historical notification baseline.
UPDATE "shipsgo_trackings"
SET
  "customs_tracking_status" = 'NOT_QUERIED',
  "customs_tracking_message" = '等待使用 API Key 查询中国海关节点。',
  "customs_last_checked_at" = NULL,
  "last_sync_time" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "provider" = 'FREIGHTOWER'
  AND "mode" = 'OCEAN'
  AND "deleted_at" IS NULL
  AND "customs_tracking_status" IN ('DISABLED', 'CREDENTIAL_REQUIRED');
