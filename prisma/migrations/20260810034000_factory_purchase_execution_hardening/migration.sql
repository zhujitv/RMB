BEGIN;

-- Repair databases that applied the initial execution migration before the
-- historical amount backfill was hardened. A PO with an unknown frozen amount
-- may not enter production; a later supplier price reply can complete it.
WITH first_delivery AS (
  SELECT DISTINCT ON ("purchase_order_id")
    "purchase_order_id",
    "delivery_date"
  FROM "factory_purchase_order_supplier_responses"
  WHERE "action" <> 'REJECTED' AND "delivery_date" IS NOT NULL
  ORDER BY "purchase_order_id", "response_sequence" ASC
)
UPDATE "factory_purchase_orders" purchase_order
SET "initial_supplier_delivery_date" = first_delivery."delivery_date"
FROM first_delivery
WHERE purchase_order."id" = first_delivery."purchase_order_id"
  AND purchase_order."initial_supplier_delivery_date" IS NULL;

WITH order_totals AS (
  SELECT
    purchase_order."id" AS "purchase_order_id",
    CASE
      WHEN COUNT(item."id") = 0
        OR COUNT(*) FILTER (WHERE COALESCE(supplier_price."amount", item."amount") IS NULL) > 0
      THEN NULL
      ELSE ROUND(SUM(COALESCE(supplier_price."amount", item."amount")), 2)
    END AS "penalty_base_amount"
  FROM "factory_purchase_orders" purchase_order
  LEFT JOIN "factory_purchase_order_items" item
    ON item."purchase_order_id" = purchase_order."id"
  LEFT JOIN "factory_purchase_order_supplier_prices" supplier_price
    ON supplier_price."purchase_order_id" = purchase_order."id"
    AND supplier_price."purchase_order_item_id" = item."id"
  GROUP BY purchase_order."id"
)
UPDATE "factory_purchase_orders" purchase_order
SET "penalty_base_amount" = order_totals."penalty_base_amount"
FROM order_totals
WHERE purchase_order."id" = order_totals."purchase_order_id"
  AND purchase_order."initial_supplier_delivery_date" IS NOT NULL
  AND purchase_order."penalty_base_amount" IS NULL
  AND order_totals."penalty_base_amount" IS NOT NULL;

UPDATE "factory_purchase_orders" purchase_order
SET "production_status" = CASE
  WHEN purchase_order."penalty_base_amount" IS NULL
    OR purchase_order."initial_supplier_delivery_date" IS NULL
  THEN 'WAITING_SUPPLIER'::"FactoryPurchaseOrderProductionStatus"
  WHEN purchase_order."prepayment_required_before_production"
    AND COALESCE((
      SELECT SUM(payment."amount")
      FROM "factory_purchase_order_payments" payment
      WHERE payment."purchase_order_id" = purchase_order."id"
        AND payment."kind" = 'PREPAYMENT'
        AND payment."status" = 'CONFIRMED'
        AND payment."paid_at" <= CURRENT_DATE
    ), 0) < ROUND(purchase_order."penalty_base_amount" * purchase_order."prepayment_ratio", 2)
  THEN 'WAITING_PREPAYMENT'::"FactoryPurchaseOrderProductionStatus"
  ELSE 'READY'::"FactoryPurchaseOrderProductionStatus"
END
WHERE purchase_order."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED')
  AND purchase_order."production_status" IN ('WAITING_SUPPLIER', 'WAITING_PREPAYMENT', 'READY');

ALTER TABLE "factory_purchase_orders"
  ADD CONSTRAINT "factory_purchase_orders_execution_anchor_check"
  CHECK (
    "production_status" = 'WAITING_SUPPLIER'
    OR (
      "production_status" IN ('WAITING_PREPAYMENT', 'READY', 'IN_PRODUCTION', 'COMPLETED')
      AND "initial_supplier_delivery_date" IS NOT NULL
      AND "penalty_base_amount" IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_adjustment"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase order adjustments cannot be deleted';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'voided factory purchase order adjustment is immutable';
  END IF;
  IF NEW."purchase_order_id" IS DISTINCT FROM OLD."purchase_order_id"
    OR NEW."sequence_no" IS DISTINCT FROM OLD."sequence_no"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."direction" IS DISTINCT FROM OLD."direction"
    OR NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at"
    OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
    OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'factory purchase order adjustment core fields are immutable';
  END IF;
  IF OLD."status" = 'CONFIRMED' AND NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'confirmed factory purchase order adjustment may only be voided';
  END IF;
  IF OLD."status" = 'PROVISIONAL' AND NEW."status" NOT IN ('CONFIRMED', 'VOIDED') THEN
    RAISE EXCEPTION 'factory purchase order adjustment may only be confirmed or voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
