BEGIN;

-- A receivable draft is the commercial handoff anchor and may be created
-- before a container number is known.  shipping_started_at remains the later
-- physical-loading finalization anchor, whose existing guard materializes and
-- freezes released-container quantities.
CREATE OR REPLACE FUNCTION "validate_receivable_order_sales_execution_lineage"() RETURNS trigger AS $$
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

COMMIT;
