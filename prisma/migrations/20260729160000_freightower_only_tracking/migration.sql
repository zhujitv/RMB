-- ShipsGo tracking data has been explicitly retired. Keep the existing table name
-- for a non-destructive schema transition, but retain only Freightower records.
DELETE FROM "shipsgo_trackings"
WHERE "provider" IS DISTINCT FROM 'FREIGHTOWER';

ALTER TABLE "shipsgo_trackings"
  ALTER COLUMN "provider" SET DEFAULT 'FREIGHTOWER';

-- Remove retired ShipsGo credentials and force the surviving integration setting
-- to the single supported provider without exposing or re-encrypting Freightower secrets.
UPDATE "system_settings"
SET "value" = jsonb_set(
  jsonb_set(
    "value"
      - 'apiKey'
      - 'apiBaseUrl'
      - 'shipsgoEnabled'
      - 'webhookSecret'
      - 'creditWarningThreshold',
    '{activeProvider}',
    '"FREIGHTOWER"'::jsonb,
    true
  ),
  '{freightowerEnabled}',
  'true'::jsonb,
  true
)
WHERE "key" = 'shipsgo_integration';
