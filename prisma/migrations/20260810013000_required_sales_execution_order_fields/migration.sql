BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_executions"
    WHERE "customer_order_no" IS NULL
       OR btrim("customer_order_no") = ''
       OR "requested_delivery_date" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot require sales execution order fields: historical rows must be completed first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "factory_purchase_orders"
    WHERE "requested_delivery_date" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot require factory purchase order delivery dates: historical rows must be completed first';
  END IF;
END $$;

ALTER TABLE "sales_executions"
  ALTER COLUMN "customer_order_no" SET NOT NULL,
  ALTER COLUMN "requested_delivery_date" SET NOT NULL;

ALTER TABLE "sales_executions"
  ADD CONSTRAINT "sales_executions_customer_order_no_not_blank_check"
  CHECK (btrim("customer_order_no") <> '');

ALTER TABLE "factory_purchase_orders"
  ALTER COLUMN "requested_delivery_date" SET NOT NULL;

CREATE INDEX "sales_executions_customer_id_customer_order_no_idx"
  ON "sales_executions"("customer_id", "customer_order_no");

COMMIT;
