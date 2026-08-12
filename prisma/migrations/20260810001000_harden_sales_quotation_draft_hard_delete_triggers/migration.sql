BEGIN;

-- Keep the transaction-local quotation id as a necessary but insufficient
-- deletion capability. The database must also see the parent quotation still
-- in DRAFT state while each immutable snapshot row is deleted.
CREATE OR REPLACE FUNCTION "reject_sales_quotation_version_mutation"() RETURNS trigger AS $$
DECLARE
  quotation_status TEXT;
BEGIN
  IF TG_OP = 'DELETE'
    AND OLD."quotation_id" = current_setting('app.quotation_hard_delete_id', TRUE) THEN
    SELECT "status"::TEXT INTO quotation_status
    FROM "sales_quotations"
    WHERE "id" = OLD."quotation_id";

    IF quotation_status = 'DRAFT' THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."sealed_at" IS NULL
      AND NEW."sealed_at" IS NOT NULL
      AND (to_jsonb(NEW) - 'sealed_at') = (to_jsonb(OLD) - 'sealed_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'sales quotation snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "guard_sales_quotation_item_mutation"() RETURNS trigger AS $$
DECLARE
  version_sealed_at TIMESTAMP(3);
  version_quotation_id TEXT;
  quotation_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT version."quotation_id", quotation."status"::TEXT
      INTO version_quotation_id, quotation_status
    FROM "sales_quotation_versions" AS version
    INNER JOIN "sales_quotations" AS quotation
      ON quotation."id" = version."quotation_id"
    WHERE version."id" = OLD."quotation_version_id";

    IF version_quotation_id = current_setting('app.quotation_hard_delete_id', TRUE)
      AND quotation_status = 'DRAFT' THEN
      RETURN OLD;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "sealed_at" INTO version_sealed_at
    FROM "sales_quotation_versions"
    WHERE "id" = NEW."quotation_version_id";
    IF version_sealed_at IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'sales quotation item snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

COMMIT;
