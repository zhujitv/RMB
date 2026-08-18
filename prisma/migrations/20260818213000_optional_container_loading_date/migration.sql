-- A container plan may open before its exact loading date is known. The date
-- becomes an actual business fact when internal staff performs final release.
DO $$
DECLARE
  definition TEXT;
  original_fragment TEXT := $fragment$IF NEW."loading_date" IS NULL
      OR allocation_count = 0 THEN$fragment$;
  replacement_fragment TEXT := $fragment$IF allocation_count = 0 THEN$fragment$;
  release_fields TEXT := $fragment$'status', 'revision', 'updated_at', 'released_at', 'released_by', 'release_remark'$fragment$;
  release_fields_with_date TEXT := $fragment$'status', 'loading_date', 'revision', 'updated_at', 'released_at', 'released_by', 'release_remark'$fragment$;
BEGIN
  SELECT pg_get_functiondef('guard_sales_execution_container_load_update()'::REGPROCEDURE)
  INTO definition;

  IF POSITION(original_fragment IN definition) = 0 THEN
    RAISE EXCEPTION 'container load guard definition is incompatible with optional loading date migration';
  END IF;
  IF POSITION(release_fields IN definition) = 0 THEN
    RAISE EXCEPTION 'container load release fields are incompatible with automatic loading date migration';
  END IF;

  definition := REPLACE(definition, original_fragment, replacement_fragment);
  definition := REPLACE(definition, release_fields, release_fields_with_date);
  EXECUTE definition;
END;
$$;
