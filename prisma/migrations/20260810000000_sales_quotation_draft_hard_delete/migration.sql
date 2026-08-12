BEGIN;

-- Quotation snapshots remain immutable by default. A reviewed hard-delete flow may
-- delete only the snapshot tree for the quotation id stored in this transaction.
CREATE OR REPLACE FUNCTION "reject_sales_quotation_version_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND OLD."quotation_id" = current_setting('app.quotation_hard_delete_id', TRUE) THEN
    RETURN OLD;
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
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT "quotation_id" INTO version_quotation_id
    FROM "sales_quotation_versions"
    WHERE "id" = OLD."quotation_version_id";
    IF version_quotation_id = current_setting('app.quotation_hard_delete_id', TRUE) THEN
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
