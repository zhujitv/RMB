BEGIN;

CREATE OR REPLACE FUNCTION "protect_receivable_order_sales_execution_source"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."source_sales_execution_id" IS NOT NULL THEN
    RAISE EXCEPTION 'sales execution generated receivable orders cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW."source_sales_execution_id" IS DISTINCT FROM OLD."source_sales_execution_id" THEN
    RAISE EXCEPTION 'receivable order sales execution source is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."source_sales_execution_id" IS NOT NULL
    AND NEW."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'sales execution generated receivable orders cannot be soft deleted';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "receivable_orders" ro
    LEFT JOIN "sales_executions" se ON se."id" = ro."source_sales_execution_id"
    WHERE ro."source_sales_execution_id" IS NOT NULL
      AND (
        se."id" IS NULL
        OR se."shipping_started_at" IS NULL
        OR se."status" <> 'DISPATCHED'::"SalesExecutionStatus"
        OR lower(btrim(ro."order_no")) <> lower(btrim(se."customer_order_no"))
        OR ro."customer_id" IS DISTINCT FROM se."customer_id"
        OR ro."business_entity_id" IS DISTINCT FROM se."business_entity_id"
        OR ro."salesperson_user_id" IS DISTINCT FROM se."salesperson_user_id"
        OR upper(btrim(ro."currency")) <> upper(btrim(se."currency"))
      )
  ) THEN
    RAISE EXCEPTION 'existing sales execution receivable order lineage is inconsistent';
  END IF;
END;
$$;

CREATE FUNCTION "validate_receivable_order_sales_execution_lineage"() RETURNS trigger AS $$
DECLARE
  source_row "sales_executions"%ROWTYPE;
BEGIN
  IF NEW."source_sales_execution_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO source_row
  FROM "sales_executions"
  WHERE "id" = NEW."source_sales_execution_id";
  IF NOT FOUND
    OR source_row."shipping_started_at" IS NULL
    OR source_row."status" <> 'DISPATCHED'::"SalesExecutionStatus"
    OR lower(btrim(NEW."order_no")) <> lower(btrim(source_row."customer_order_no"))
    OR NEW."customer_id" IS DISTINCT FROM source_row."customer_id"
    OR NEW."business_entity_id" IS DISTINCT FROM source_row."business_entity_id"
    OR NEW."salesperson_user_id" IS DISTINCT FROM source_row."salesperson_user_id"
    OR upper(btrim(NEW."currency")) <> upper(btrim(source_row."currency")) THEN
    RAISE EXCEPTION 'receivable order sales execution lineage is inconsistent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "receivable_orders_sales_execution_lineage_check"
  AFTER INSERT OR UPDATE ON "receivable_orders"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW."source_sales_execution_id" IS NOT NULL)
  EXECUTE FUNCTION "validate_receivable_order_sales_execution_lineage"();

COMMIT;
