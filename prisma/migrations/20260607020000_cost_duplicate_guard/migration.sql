CREATE INDEX IF NOT EXISTS "order_costs_duplicate_lookup_idx"
ON "order_costs"("order_id", "supplier_id", "cost_type", "amount", "created_by", "created_at");

WITH duplicate_costs AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY
        "order_id",
        COALESCE("supplier_id", ''),
        "cost_type",
        "amount",
        COALESCE("created_by", ''),
        date_trunc('minute', "created_at")
      ORDER BY "created_at" ASC, "id" ASC
    ) AS duplicate_rank
  FROM "order_costs"
  WHERE "deleted_at" IS NULL
)
UPDATE "order_costs"
SET "deleted_at" = CURRENT_TIMESTAMP,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  SELECT "id"
  FROM duplicate_costs
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_costs_duplicate_minute_guard"
ON "order_costs"(
  "order_id",
  (COALESCE("supplier_id", '')),
  "cost_type",
  "amount",
  (COALESCE("created_by", '')),
  (date_trunc('minute', "created_at"))
)
WHERE "deleted_at" IS NULL;
