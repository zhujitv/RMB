-- Permit the audited quantity-correction transaction to clear a stale shipping
-- handoff marker. The normal shipping freeze remains immutable for every other
-- application path and for raw SQL writes.

CREATE OR REPLACE FUNCTION "protect_sales_execution_shipping_anchor"() RETURNS trigger AS $$
DECLARE
  quantity_correction BOOLEAN := current_setting('app.sales_quantity_correction', true) = 'on';
  active_purchase_order_count INTEGER;
  invalid_purchase_order_count INTEGER;
  missing_actual_quantity_count INTEGER;
  short_execution_item_count INTEGER;
  unreleased_active_container_count INTEGER;
BEGIN
  IF OLD."shipping_started_at" IS NOT NULL AND (
    NEW."shipping_started_at" IS DISTINCT FROM OLD."shipping_started_at"
    OR NEW."shipping_started_by" IS DISTINCT FROM OLD."shipping_started_by"
    OR NEW."status" IS DISTINCT FROM OLD."status"
  ) THEN
    IF NOT (
      quantity_correction IS TRUE
      AND NEW."status" IS NOT DISTINCT FROM OLD."status"
      AND NEW."shipping_started_at" IS NULL
      AND NEW."shipping_started_by" IS NULL
    ) THEN
      RAISE EXCEPTION 'sales execution shipping handoff is immutable';
    END IF;
  END IF;

  IF OLD."shipping_started_at" IS NULL AND NEW."shipping_started_at" IS NOT NULL THEN
    IF NEW."status" <> 'DISPATCHED'::"SalesExecutionStatus"
      OR NOT EXISTS (
        SELECT 1 FROM "users" actor
        WHERE actor."id" = NEW."shipping_started_by"
          AND actor."supplier_id" IS NULL
          AND actor."is_active" = TRUE
          AND actor."approval_status" = 'APPROVED'
          AND actor."deleted_at" IS NULL
      ) THEN
      RAISE EXCEPTION 'shipping requires a dispatched execution and an active approved internal actor';
    END IF;

    PERFORM purchase_order."id"
    FROM "factory_purchase_orders" purchase_order
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
    ORDER BY purchase_order."id"
    FOR UPDATE;

    PERFORM item."id"
    FROM "factory_purchase_order_items" item
    INNER JOIN "factory_purchase_orders" purchase_order
      ON purchase_order."id" = item."purchase_order_id"
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
    ORDER BY item."id"
    FOR UPDATE OF item;

    SELECT COUNT(*)
    INTO unreleased_active_container_count
    FROM "sales_execution_container_loads" load
    WHERE load."execution_id" = NEW."id"
      AND load."status" NOT IN ('RELEASED', 'VOIDED')
      AND EXISTS (
        SELECT 1
        FROM "container_load_allocations" allocation
        INNER JOIN "factory_purchase_orders" purchase_order
          ON purchase_order."id" = allocation."purchase_order_id"
        WHERE allocation."container_load_id" = load."id"
          AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
      );
    IF unreleased_active_container_count <> 0 THEN
      RAISE EXCEPTION 'shipping requires every non-void container with active purchase-order allocations to be released';
    END IF;

    SELECT COUNT(*), COUNT(*) FILTER (
      WHERE purchase_order."status" <> 'ACCEPTED'
        OR purchase_order."production_status" <> 'COMPLETED'
        OR purchase_order."production_completed_at" IS NULL
        OR purchase_order."production_completed_by" IS NULL
        OR purchase_order."actual_delivery_date" IS NULL
        OR EXISTS (
          SELECT 1
          FROM "factory_purchase_order_delivery_quantity_variances" variance
          WHERE variance."purchase_order_id" = purchase_order."id"
            AND variance."status" = 'PENDING'
        )
    )
    INTO active_purchase_order_count, invalid_purchase_order_count
    FROM "factory_purchase_orders" purchase_order
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED');
    IF active_purchase_order_count = 0 OR invalid_purchase_order_count <> 0 THEN
      RAISE EXCEPTION 'shipping requires every active factory purchase order to be accepted, completed and delivered';
    END IF;

    SELECT COUNT(*)
    INTO missing_actual_quantity_count
    FROM "factory_purchase_order_items" item
    INNER JOIN "factory_purchase_orders" purchase_order
      ON purchase_order."id" = item."purchase_order_id"
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
      AND item."actual_delivered_quantity" IS NULL;
    IF missing_actual_quantity_count <> 0 THEN
      RAISE EXCEPTION 'shipping requires every active purchase-order item actual delivered quantity';
    END IF;

    SELECT COUNT(*)
    INTO short_execution_item_count
    FROM "sales_execution_items" execution_item
    LEFT JOIN (
      SELECT item."execution_item_id",
             SUM(item."actual_delivered_quantity") AS delivered_quantity
      FROM "factory_purchase_order_items" item
      INNER JOIN "factory_purchase_orders" purchase_order
        ON purchase_order."id" = item."purchase_order_id"
      WHERE purchase_order."execution_id" = NEW."id"
        AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
      GROUP BY item."execution_item_id"
    ) delivered ON delivered."execution_item_id" = execution_item."id"
    WHERE execution_item."execution_id" = NEW."id"
      AND COALESCE(delivered.delivered_quantity, 0) < execution_item."quantity";
    IF short_execution_item_count <> 0 THEN
      RAISE EXCEPTION 'shipping actual delivered quantity does not cover every sales execution item';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
