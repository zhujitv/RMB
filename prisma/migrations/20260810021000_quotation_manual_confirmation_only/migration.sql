BEGIN;

-- A legacy email-linked response is delivery history, not authoritative
-- customer acceptance. Stop for manual review if such a row already produced
-- a sales execution; silently changing that chain would break auditability.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_quotation_decisions" AS decision
    INNER JOIN "sales_executions" AS execution
      ON execution."source_quotation_version_id" = decision."quotation_version_id"
    WHERE decision."channel" = 'SYSTEM_EMAIL'
  ) THEN
    RAISE EXCEPTION 'Cannot remove legacy email decisions: linked sales executions require manual review';
  END IF;
END;
$$;

-- Release current quotations that were locked by the old email-response path.
-- Their delivery row remains as historical evidence, while the quotation must
-- wait for a new internal manual confirmation before execution.
UPDATE "sales_quotations" AS quotation
SET
  "status" = 'SENT',
  "updated_at" = CURRENT_TIMESTAMP
FROM "sales_quotation_versions" AS version
INNER JOIN "sales_quotation_decisions" AS decision
  ON decision."quotation_version_id" = version."id"
WHERE
  decision."channel" = 'SYSTEM_EMAIL'
  AND version."quotation_id" = quotation."id"
  AND version."version_number" = quotation."current_version_number"
  AND quotation."status" IN ('ACCEPTED', 'REJECTED');

DROP TRIGGER "sales_quotation_decisions_immutable" ON "sales_quotation_decisions";

DELETE FROM "sales_quotation_decisions"
WHERE "channel" = 'SYSTEM_EMAIL';

CREATE TRIGGER "sales_quotation_decisions_immutable"
  BEFORE UPDATE OR DELETE ON "sales_quotation_decisions"
  FOR EACH ROW EXECUTE FUNCTION "reject_sales_quotation_decision_mutation"();

-- A new customer decision must only be created by the internal
-- manual-confirmation workflow. Replacing the existing guard keeps the rule at
-- the database edge while allowing the now-clean historical schema to remain.
CREATE OR REPLACE FUNCTION "validate_sales_quotation_decision_insert"() RETURNS trigger AS $$
BEGIN
  IF NEW."channel" = 'SYSTEM_EMAIL' THEN
    RAISE EXCEPTION 'PI email delivery cannot confirm a quotation; use manual confirmation';
  END IF;

  IF NEW."delivery_id" IS NOT NULL THEN
    RAISE EXCEPTION 'manual quotation decision cannot reference a system delivery';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The legacy delivery response columns remain readable in the database for
-- audit purposes, but no new request may populate or change them.
CREATE FUNCTION "reject_quotation_delivery_response_write"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."response_status" IS NOT NULL
      OR NEW."response_reason" IS NOT NULL
      OR NEW."responded_by" IS NOT NULL
      OR NEW."responded_at" IS NOT NULL THEN
      RAISE EXCEPTION 'PI email delivery cannot store a customer confirmation';
    END IF;
  ELSIF NEW."response_status" IS DISTINCT FROM OLD."response_status"
    OR NEW."response_reason" IS DISTINCT FROM OLD."response_reason"
    OR NEW."responded_by" IS DISTINCT FROM OLD."responded_by"
    OR NEW."responded_at" IS DISTINCT FROM OLD."responded_at" THEN
    RAISE EXCEPTION 'PI email delivery cannot store a customer confirmation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_quotation_deliveries_response_write_guard"
  BEFORE INSERT OR UPDATE ON "sales_quotation_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "reject_quotation_delivery_response_write"();

COMMIT;
