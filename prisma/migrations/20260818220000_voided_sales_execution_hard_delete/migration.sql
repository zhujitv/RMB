BEGIN;

-- Physical deletion is intentionally unavailable during normal writes. The
-- application sets this transaction-local identifier only after it has locked,
-- authorized and revalidated one VOIDED sales execution.
CREATE OR REPLACE FUNCTION "sales_execution_hard_delete_allowed"(
  table_name TEXT,
  old_row JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  requested_execution_id TEXT := NULLIF(current_setting('app.sales_execution_hard_delete_id', TRUE), '');
  resolved_execution_id TEXT;
  purchase_order_id TEXT;
BEGIN
  IF requested_execution_id IS NULL THEN RETURN FALSE; END IF;

  IF table_name = 'sales_executions' THEN
    resolved_execution_id := old_row ->> 'id';
  ELSIF table_name IN (
    'sales_execution_items',
    'sales_execution_versions',
    'sales_execution_container_loads',
    'container_load_allocations'
  ) THEN
    resolved_execution_id := old_row ->> 'execution_id';
  ELSIF table_name = 'factory_purchase_orders' THEN
    resolved_execution_id := old_row ->> 'execution_id';
  ELSE
    purchase_order_id := old_row ->> 'purchase_order_id';
    IF purchase_order_id IS NOT NULL THEN
      SELECT "execution_id" INTO resolved_execution_id
      FROM "factory_purchase_orders"
      WHERE "id" = purchase_order_id;
    END IF;
  END IF;

  IF resolved_execution_id IS DISTINCT FROM requested_execution_id THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1
    FROM "sales_executions"
    WHERE "id" = requested_execution_id
      AND "status" = 'VOIDED'
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Preserve every existing trigger invariant, but insert a narrowly scoped
-- early exit into DELETE-capable trigger functions for execution-owned rows.
-- This avoids weakening ordinary direct SQL or application mutations.
DO $$
DECLARE
  trigger_function RECORD;
  definition TEXT;
  guarded_definition TEXT;
BEGIN
  FOR trigger_function IN
    SELECT DISTINCT procedure.oid, procedure.proname
    FROM pg_trigger AS trigger
    INNER JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
    INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    INNER JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
    WHERE namespace.nspname = 'public'
      AND NOT trigger.tgisinternal
      AND (trigger.tgtype & 8) = 8
      AND relation.relname IN (
        'sales_executions',
        'sales_execution_items',
        'sales_execution_versions',
        'factory_purchase_orders',
        'factory_purchase_order_items',
        'factory_purchase_order_supplier_responses',
        'factory_purchase_order_supplier_prices',
        'factory_purchase_order_production_reports',
        'factory_purchase_order_production_report_items',
        'factory_purchase_order_delivery_quantity_variances',
        'factory_purchase_order_delivery_quantity_variance_items',
        'factory_purchase_order_payments',
        'factory_purchase_order_adjustments',
        'factory_purchase_order_settlements',
        'sales_execution_container_loads',
        'container_load_allocations',
        'factory_purchase_order_loading_results',
        'factory_purchase_order_loading_result_items'
      )
  LOOP
    definition := pg_get_functiondef(trigger_function.oid);
    IF POSITION('sales_execution_hard_delete_allowed' IN definition) > 0 THEN CONTINUE; END IF;
    IF POSITION(E'\nBEGIN\n' IN definition) = 0 THEN
      RAISE EXCEPTION 'cannot install sales execution hard-delete guard in trigger function %', trigger_function.proname;
    END IF;
    guarded_definition := regexp_replace(
      definition,
      E'\nBEGIN\n',
      E'\nBEGIN\n  IF TG_OP = ''DELETE'' AND "sales_execution_hard_delete_allowed"(TG_TABLE_NAME, TO_JSONB(OLD)) THEN\n    RETURN OLD;\n  END IF;\n',
      1,
      1
    );
    EXECUTE guarded_definition;
  END LOOP;
END;
$$;

COMMIT;
