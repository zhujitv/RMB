BEGIN;

CREATE TYPE "SalesQuotationDecisionChannel" AS ENUM (
  'SYSTEM_EMAIL',
  'EXTERNAL_EMAIL',
  'WECHAT',
  'WHATSAPP',
  'PHONE',
  'OTHER'
);

CREATE TABLE "sales_quotation_decisions" (
  "id" TEXT NOT NULL,
  "quotation_id" TEXT NOT NULL,
  "quotation_version_id" TEXT NOT NULL,
  "delivery_id" TEXT,
  "channel" "SalesQuotationDecisionChannel" NOT NULL,
  "decision" "SalesQuotationResponseStatus" NOT NULL,
  "responded_at" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "recorded_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_quotation_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_quotation_decisions_channel_delivery_check" CHECK (
    ("channel" = 'SYSTEM_EMAIL' AND "delivery_id" IS NOT NULL)
    OR ("channel" <> 'SYSTEM_EMAIL' AND "delivery_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "sales_quotation_decisions_quotation_version_id_key"
  ON "sales_quotation_decisions"("quotation_version_id");
CREATE UNIQUE INDEX "sales_quotation_decisions_quotation_version_id_quotation_id_key"
  ON "sales_quotation_decisions"("quotation_version_id", "quotation_id");
CREATE UNIQUE INDEX "sales_quotation_decisions_delivery_id_key"
  ON "sales_quotation_decisions"("delivery_id");
CREATE INDEX "sales_quotation_decisions_quotation_id_created_at_idx"
  ON "sales_quotation_decisions"("quotation_id", "created_at");
CREATE INDEX "sales_quotation_decisions_recorded_by_idx"
  ON "sales_quotation_decisions"("recorded_by");

ALTER TABLE "sales_quotation_decisions"
  ADD CONSTRAINT "sales_quotation_decisions_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "sales_quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_decisions"
  ADD CONSTRAINT "sales_quotation_decisions_quotation_version_id_quotation_id_fkey"
  FOREIGN KEY ("quotation_version_id", "quotation_id")
  REFERENCES "sales_quotation_versions"("id", "quotation_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_decisions"
  ADD CONSTRAINT "sales_quotation_decisions_delivery_id_fkey"
  FOREIGN KEY ("delivery_id") REFERENCES "sales_quotation_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_decisions"
  ADD CONSTRAINT "sales_quotation_decisions_recorded_by_fkey"
  FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The legacy delivery columns are retained for compatibility, but every
-- historical response must become exactly one immutable version decision.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_quotation_deliveries"
    WHERE ("response_status" IS NULL) <> ("responded_at" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Cannot backfill quotation decisions: incomplete delivery response records exist';
  END IF;

  IF EXISTS (
    SELECT "quotation_version_id"
    FROM "sales_quotation_deliveries"
    WHERE "response_status" IS NOT NULL
    GROUP BY "quotation_version_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot backfill quotation decisions: multiple responses exist for one quotation version';
  END IF;
END;
$$;

INSERT INTO "sales_quotation_decisions" (
  "id",
  "quotation_id",
  "quotation_version_id",
  "delivery_id",
  "channel",
  "decision",
  "responded_at",
  "note",
  "recorded_by",
  "created_at"
)
SELECT
  'qdec_' || md5("id"),
  "quotation_id",
  "quotation_version_id",
  "id",
  'SYSTEM_EMAIL'::"SalesQuotationDecisionChannel",
  "response_status",
  "responded_at",
  "response_reason",
  "responded_by",
  "responded_at"
FROM "sales_quotation_deliveries"
WHERE "response_status" IS NOT NULL;

-- Do not silently migrate a quotation whose current status has already drifted
-- away from its recorded customer decision. Such rows need a reviewed repair.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "sales_quotations" AS quotation
    INNER JOIN "sales_quotation_versions" AS version
      ON version."quotation_id" = quotation."id"
      AND version."version_number" = quotation."current_version_number"
    LEFT JOIN "sales_quotation_decisions" AS decision
      ON decision."quotation_version_id" = version."id"
    WHERE
      quotation."status" <> 'VOIDED'
      AND (
        ((quotation."status" IN ('ACCEPTED', 'REJECTED')) <> (decision."id" IS NOT NULL))
        OR (
          decision."id" IS NOT NULL
          AND decision."decision"::TEXT <> quotation."status"::TEXT
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot migrate quotation decisions: current quotation status and decision evidence disagree';
  END IF;
END;
$$;

CREATE FUNCTION "validate_sales_quotation_decision_insert"() RETURNS trigger AS $$
DECLARE
  delivery_response "SalesQuotationResponseStatus";
BEGIN
  IF NEW."channel" = 'SYSTEM_EMAIL' THEN
    SELECT "response_status" INTO delivery_response
    FROM "sales_quotation_deliveries"
    WHERE "id" = NEW."delivery_id"
      AND "quotation_id" = NEW."quotation_id"
      AND "quotation_version_id" = NEW."quotation_version_id";

    IF delivery_response IS NULL OR delivery_response IS DISTINCT FROM NEW."decision" THEN
      RAISE EXCEPTION 'system email quotation decision must match its delivery response';
    END IF;
  ELSIF NEW."delivery_id" IS NOT NULL THEN
    RAISE EXCEPTION 'manual quotation decision cannot reference a system delivery';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_quotation_decisions_insert_guard"
  BEFORE INSERT ON "sales_quotation_decisions"
  FOR EACH ROW EXECUTE FUNCTION "validate_sales_quotation_decision_insert"();

CREATE FUNCTION "reject_sales_quotation_decision_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sales quotation decisions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_quotation_decisions_immutable"
  BEFORE UPDATE OR DELETE ON "sales_quotation_decisions"
  FOR EACH ROW EXECUTE FUNCTION "reject_sales_quotation_decision_mutation"();

COMMIT;
