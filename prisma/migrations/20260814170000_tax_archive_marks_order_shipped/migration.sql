BEGIN;

-- A submitted tax-refund archive proves the goods have been exported. Keep
-- collection and terminal states, but advance earlier legacy orders to shipped.
UPDATE "receivable_orders"
SET
  "status" = '已发货',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "deleted_at" IS NULL
  AND (
    "tax_archived" = TRUE
    OR "tax_refund_archived_at" IS NOT NULL
    OR "tax_submitted_at" IS NOT NULL
    OR "tax_refund_status" IN ('SUBMITTED', 'REFUND_RECEIVED', 'COMPLETED', 'ARCHIVED')
  )
  AND "status" NOT IN ('已发货', '部分收款', '已收齐', '多收款', '已关闭', '已取消');

-- Backfill the first real domestic departure for existing truck and multimodal
-- records. Detail rows are authoritative; the header date covers legacy rows
-- created before transport items existed. Never replace a manually maintained
-- shipment date or turn a future planned departure into an actual shipment.
WITH "latest_domestic_info" AS (
  SELECT DISTINCT ON (info."order_id")
    info."id",
    info."order_id",
    info."transport_type",
    info."departure_date"
  FROM "domestic_logistics_infos" AS info
  WHERE info."deleted_at" IS NULL
  ORDER BY info."order_id", info."updated_at" DESC, info."created_at" DESC, info."id" DESC
),
"domestic_departures" AS (
  SELECT
    info."order_id",
    CASE
      WHEN COUNT(item."id") > 0
        THEN MIN(item."departure_date") FILTER (WHERE item."departure_date" <= CURRENT_DATE)
      ELSE MIN(info."departure_date") FILTER (WHERE info."departure_date" <= CURRENT_DATE)
    END AS "departure_date"
  FROM "latest_domestic_info" AS info
  LEFT JOIN "logistics_transport_items" AS item
    ON item."logistics_info_id" = info."id"
  WHERE info."transport_type" IN ('TRUCK', 'MULTIMODAL')
  GROUP BY info."order_id", info."departure_date"
)
UPDATE "receivable_orders" AS orders
SET
  "actual_shipment_date" = departures."departure_date",
  "status" = CASE
    WHEN orders."status" NOT IN ('已发货', '部分收款', '已收齐', '多收款', '已关闭', '已取消') THEN '已发货'
    ELSE orders."status"
  END,
  "updated_at" = CURRENT_TIMESTAMP
FROM "domestic_departures" AS departures
WHERE orders."id" = departures."order_id"
  AND orders."deleted_at" IS NULL
  AND orders."actual_shipment_date" IS NULL
  AND departures."departure_date" IS NOT NULL;

COMMIT;
