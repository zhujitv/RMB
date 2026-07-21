BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "commission_settlements"
    GROUP BY "order_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate commission settlements found; repair the affected orders before applying this migration.';
  END IF;
END $$;

ALTER TABLE "commission_settlements"
  ADD COLUMN "commission_formula_mode" TEXT,
  ADD COLUMN "commission_formula_label" TEXT,
  ADD COLUMN "commission_formula_description" TEXT,
  ADD COLUMN "commission_formula_source" TEXT,
  ADD COLUMN "commission_formula_deductions" JSONB,
  ADD COLUMN "commission_formula_floor_at_zero" BOOLEAN,
  ADD COLUMN "commission_formula_version" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "reversed_at" TIMESTAMP(3),
  ADD COLUMN "reversed_by" TEXT,
  ADD COLUMN "reversal_reason" TEXT;

UPDATE "commission_settlements"
SET "commission_formula_version" = 'legacy'
WHERE "commission_formula_version" IS NULL;

ALTER TABLE "commission_settlements"
  ALTER COLUMN "commission_formula_version" SET DEFAULT 'v1',
  ALTER COLUMN "commission_formula_version" SET NOT NULL;

ALTER TABLE "commission_settlements"
  ADD CONSTRAINT "commission_settlements_reversed_by_fkey"
  FOREIGN KEY ("reversed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commission_settlements"
  ADD CONSTRAINT "commission_settlements_status_check"
  CHECK (
    ("status" = 'ACTIVE' AND "reversed_at" IS NULL)
    OR ("status" = 'REVERSED' AND "reversed_at" IS NOT NULL)
  );

CREATE UNIQUE INDEX "commission_settlements_one_active_per_order_idx"
  ON "commission_settlements"("order_id")
  WHERE "status" = 'ACTIVE' AND "reversed_at" IS NULL;

CREATE INDEX "commission_settlements_order_id_status_settled_at_idx"
  ON "commission_settlements"("order_id", "status", "settled_at");

CREATE INDEX "commission_settlements_reversed_by_idx"
  ON "commission_settlements"("reversed_by");

CREATE INDEX "commission_settlements_reversed_at_idx"
  ON "commission_settlements"("reversed_at");

COMMIT;
