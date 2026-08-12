BEGIN;

ALTER TABLE "sales_quotations"
  ADD COLUMN "invoice_no" TEXT;

ALTER TABLE "sales_quotation_versions"
  ADD COLUMN "invoice_no_snapshot" TEXT;

CREATE TABLE "sales_quotation_invoice_sequences" (
  "invoice_date" DATE NOT NULL,
  "last_sequence" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_quotation_invoice_sequences_pkey" PRIMARY KEY ("invoice_date"),
  CONSTRAINT "sales_quotation_invoice_sequences_last_sequence_check" CHECK ("last_sequence" >= 0)
);

-- Sequence zero has no suffix. Positive values use spreadsheet-style letters:
-- 1=A, 26=Z, 27=AA, and so on.
CREATE FUNCTION "sales_quotation_invoice_suffix"("sequence_value" INTEGER)
RETURNS TEXT AS $$
DECLARE
  remaining INTEGER := "sequence_value";
  suffix TEXT := '';
BEGIN
  IF remaining <= 0 THEN
    RETURN '';
  END IF;

  WHILE remaining > 0 LOOP
    remaining := remaining - 1;
    suffix := CHR(65 + (remaining % 26)) || suffix;
    remaining := remaining / 26;
  END LOOP;

  RETURN suffix;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- Backfill only the parent quotation number. Historical version snapshots stay
-- NULL intentionally, so an old PI still falls back to its original quote_no.
WITH first_versions AS (
  SELECT "quotation_id", "quote_date"
  FROM (
    SELECT
      version."quotation_id",
      version."quote_date",
      ROW_NUMBER() OVER (
        PARTITION BY version."quotation_id"
        ORDER BY version."version_number" ASC, version."created_at" ASC, version."id" ASC
      ) AS version_rank
    FROM "sales_quotation_versions" AS version
  ) AS ranked_versions
  WHERE ranked_versions.version_rank = 1
), ranked_quotations AS (
  SELECT
    quotation."id",
    first_version."quote_date",
    (
      ROW_NUMBER() OVER (
        PARTITION BY first_version."quote_date"
        ORDER BY quotation."created_at" ASC, quotation."id" ASC
      ) - 1
    )::INTEGER AS invoice_sequence
  FROM "sales_quotations" AS quotation
  INNER JOIN first_versions AS first_version
    ON first_version."quotation_id" = quotation."id"
)
UPDATE "sales_quotations" AS quotation
SET "invoice_no" =
  TO_CHAR(ranked."quote_date", 'YYYYMMDD')
  || "sales_quotation_invoice_suffix"(ranked.invoice_sequence)
FROM ranked_quotations AS ranked
WHERE quotation."id" = ranked."id";

INSERT INTO "sales_quotation_invoice_sequences" (
  "invoice_date",
  "last_sequence",
  "updated_at"
)
SELECT
  first_version."quote_date",
  (COUNT(*) - 1)::INTEGER,
  CURRENT_TIMESTAMP
FROM "sales_quotations" AS quotation
INNER JOIN (
  SELECT "quotation_id", "quote_date"
  FROM (
    SELECT
      version."quotation_id",
      version."quote_date",
      ROW_NUMBER() OVER (
        PARTITION BY version."quotation_id"
        ORDER BY version."version_number" ASC, version."created_at" ASC, version."id" ASC
      ) AS version_rank
    FROM "sales_quotation_versions" AS version
  ) AS ranked_versions
  WHERE ranked_versions.version_rank = 1
) AS first_version
  ON first_version."quotation_id" = quotation."id"
GROUP BY first_version."quote_date";

CREATE UNIQUE INDEX "sales_quotations_invoice_no_key"
  ON "sales_quotations"("invoice_no");

DROP FUNCTION "sales_quotation_invoice_suffix"(INTEGER);

COMMIT;
