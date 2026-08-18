-- Allow a loading ledger without a container number for bulk-warehouse cargo.
-- The existing nullable container_no is authoritative: NULL means a bulk
-- warehouse loading batch; a non-NULL value remains a physical container.
DO $$
DECLARE
  definition TEXT;
  original_fragment TEXT := $fragment$IF NULLIF(BTRIM(NEW."container_no"), '') IS NULL
      OR NEW."loading_date" IS NULL
      OR allocation_count = 0 THEN$fragment$;
  replacement_fragment TEXT := $fragment$IF NEW."loading_date" IS NULL
      OR allocation_count = 0 THEN$fragment$;
BEGIN
  SELECT pg_get_functiondef('guard_sales_execution_container_load_update()'::REGPROCEDURE)
  INTO definition;

  IF POSITION(original_fragment IN definition) = 0 THEN
    RAISE EXCEPTION 'container load guard definition is incompatible with bulk warehouse migration';
  END IF;

  definition := REPLACE(definition, original_fragment, replacement_fragment);
  EXECUTE definition;
END;
$$;
