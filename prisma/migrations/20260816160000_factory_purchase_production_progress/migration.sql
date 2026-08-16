BEGIN;

-- Keep the historical-completion backfill and the new progress guards inside
-- one write-free window. If the old application is still completing a
-- purchase order, fail this migration promptly and retry after writes stop
-- instead of committing an order without its initial 100% snapshot.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';
LOCK TABLE
  "factory_purchase_orders",
  "factory_purchase_order_items",
  "users"
IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "factory_purchase_order_production_reports" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "reported_by" TEXT NOT NULL,
  "source" "FactoryConfirmationSource" NOT NULL DEFAULT 'SUPPLIER_PORTAL',
  "channel" "FactoryConfirmationChannel" NOT NULL DEFAULT 'PORTAL',
  "supplier_contact" TEXT NOT NULL,
  "supplier_reported_at" TIMESTAMP(3) NOT NULL,
  "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "factory_purchase_order_production_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fpo_production_report_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "fpo_production_report_contact_check" CHECK (
    CHAR_LENGTH("supplier_contact") BETWEEN 1 AND 100
  ),
  CONSTRAINT "fpo_production_report_remark_check" CHECK (
    "remark" IS NULL OR CHAR_LENGTH("remark") <= 2000
  )
);

CREATE TABLE "factory_purchase_order_production_report_items" (
  "id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "purchase_order_item_id" TEXT NOT NULL,
  "completed_quantity" DECIMAL(18,4) NOT NULL,

  CONSTRAINT "factory_purchase_order_production_report_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fpo_production_report_completed_quantity_check" CHECK ("completed_quantity" >= 0)
);

CREATE UNIQUE INDEX "fpo_production_report_po_sequence_key"
  ON "factory_purchase_order_production_reports"("purchase_order_id", "sequence_no");
CREATE UNIQUE INDEX "fpo_production_report_id_po_key"
  ON "factory_purchase_order_production_reports"("id", "purchase_order_id");
CREATE INDEX "fpo_production_report_po_time_idx"
  ON "factory_purchase_order_production_reports"("purchase_order_id", "reported_at");
CREATE INDEX "fpo_production_report_user_idx"
  ON "factory_purchase_order_production_reports"("reported_by");
CREATE UNIQUE INDEX "fpo_production_report_item_report_line_key"
  ON "factory_purchase_order_production_report_items"("report_id", "purchase_order_item_id");
CREATE INDEX "fpo_production_report_item_po_line_idx"
  ON "factory_purchase_order_production_report_items"("purchase_order_id", "purchase_order_item_id");

ALTER TABLE "factory_purchase_order_production_reports"
  ADD CONSTRAINT "fpo_production_report_purchase_order_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "factory_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_production_report_reported_by_fkey"
  FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_production_report_items"
  ADD CONSTRAINT "fpo_production_report_item_report_fkey"
  FOREIGN KEY ("report_id", "purchase_order_id")
  REFERENCES "factory_purchase_order_production_reports"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_production_report_item_purchase_line_fkey"
  FOREIGN KEY ("purchase_order_item_id", "purchase_order_id")
  REFERENCES "factory_purchase_order_items"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_report_item"() RETURNS trigger AS $$
DECLARE
  allocated_quantity NUMERIC(18,4);
BEGIN
  SELECT item."allocated_quantity"
  INTO allocated_quantity
  FROM "factory_purchase_order_items" AS item
  WHERE item."id" = NEW."purchase_order_item_id"
    AND item."purchase_order_id" = NEW."purchase_order_id";

  IF allocated_quantity IS NULL THEN
    RAISE EXCEPTION 'production progress references an invalid purchase-order item';
  END IF;
  IF NEW."completed_quantity" > allocated_quantity THEN
    RAISE EXCEPTION 'production completed quantity exceeds allocated quantity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_production_report_item_guard"
BEFORE INSERT ON "factory_purchase_order_production_report_items"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_production_report_item"();

-- Preserve the existing completed-production workflow. A historical completed
-- order is represented as one immutable 100% snapshot so the new completion
-- and shipping gates do not invalidate business facts recorded before rollout.
INSERT INTO "factory_purchase_order_production_reports" (
  "id", "purchase_order_id", "sequence_no", "reported_by", "source", "channel",
  "supplier_contact", "supplier_reported_at", "reported_at", "remark", "created_at"
)
SELECT
  'fpo-progress-' || MD5(purchase_order."id"),
  purchase_order."id",
  1,
  purchase_order."production_completed_by",
  COALESCE(purchase_order."production_completion_source", 'INTERNAL_OFFLINE'::"FactoryConfirmationSource"),
  COALESCE(purchase_order."production_completion_channel", 'OTHER'::"FactoryConfirmationChannel"),
  COALESCE(NULLIF(purchase_order."production_completion_contact", ''), '历史完工确认'),
  purchase_order."production_completed_at",
  purchase_order."production_completed_at",
  '系统根据历史生产完成记录回填',
  purchase_order."production_completed_at"
FROM "factory_purchase_orders" AS purchase_order
WHERE purchase_order."status" = 'ACCEPTED'
  AND purchase_order."production_status" = 'COMPLETED'
  AND purchase_order."production_completed_by" IS NOT NULL
  AND purchase_order."production_completed_at" IS NOT NULL;

INSERT INTO "factory_purchase_order_production_report_items" (
  "id", "report_id", "purchase_order_id", "purchase_order_item_id", "completed_quantity"
)
SELECT
  'fpo-progress-item-' || MD5(item."id"),
  'fpo-progress-' || MD5(item."purchase_order_id"),
  item."purchase_order_id",
  item."id",
  item."allocated_quantity"
FROM "factory_purchase_order_items" AS item
INNER JOIN "factory_purchase_order_production_reports" AS report
  ON report."id" = 'fpo-progress-' || MD5(item."purchase_order_id")
  AND report."purchase_order_id" = item."purchase_order_id";

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_report_insert"() RETURNS trigger AS $$
DECLARE
  purchase_order_supplier_id TEXT;
  purchase_order_status TEXT;
  purchase_order_production_status TEXT;
  production_started_at TIMESTAMP(3);
  expected_sequence INTEGER;
BEGIN
  SELECT
    purchase_order."supplier_id",
    purchase_order."status"::TEXT,
    purchase_order."production_status"::TEXT,
    purchase_order."production_started_at"
  INTO
    purchase_order_supplier_id,
    purchase_order_status,
    purchase_order_production_status,
    production_started_at
  FROM "factory_purchase_orders" AS purchase_order
  WHERE purchase_order."id" = NEW."purchase_order_id";

  IF purchase_order_supplier_id IS NULL
    OR purchase_order_status <> 'ACCEPTED'
    OR purchase_order_production_status <> 'IN_PRODUCTION' THEN
    RAISE EXCEPTION 'production progress requires an accepted in-production purchase order';
  END IF;
  IF NEW."supplier_reported_at" < production_started_at
    OR NEW."supplier_reported_at" > NEW."reported_at"
    OR NEW."reported_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'production progress report time is invalid';
  END IF;
  IF NEW."source" = 'SUPPLIER_PORTAL' THEN
    IF NEW."channel" <> 'PORTAL' OR NOT EXISTS (
      SELECT 1
      FROM "users" AS reporter
      WHERE reporter."id" = NEW."reported_by"
        AND reporter."supplier_id" = purchase_order_supplier_id
        AND reporter."is_active" = TRUE
        AND reporter."approval_status" = 'APPROVED'
        AND reporter."deleted_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'production progress reporter is not an active operator for this supplier';
    END IF;
  ELSIF NEW."source" = 'INTERNAL_OFFLINE' THEN
    IF NEW."channel" = 'PORTAL' OR NOT EXISTS (
      SELECT 1
      FROM "users" AS reporter
      WHERE reporter."id" = NEW."reported_by"
        AND reporter."supplier_id" IS NULL
        AND reporter."is_active" = TRUE
        AND reporter."approval_status" = 'APPROVED'
        AND reporter."deleted_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'offline production progress requires an active internal operator';
    END IF;
  ELSE
    RAISE EXCEPTION 'production progress source is invalid';
  END IF;
  SELECT COALESCE(MAX(report."sequence_no"), 0) + 1
  INTO expected_sequence
  FROM "factory_purchase_order_production_reports" AS report
  WHERE report."purchase_order_id" = NEW."purchase_order_id";
  IF NEW."sequence_no" <> expected_sequence THEN
    RAISE EXCEPTION 'production progress sequence is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_production_report_insert_guard"
BEFORE INSERT ON "factory_purchase_order_production_reports"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_production_report_insert"();

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_production_report_snapshot"() RETURNS trigger AS $$
DECLARE
  expected_item_count INTEGER;
  reported_item_count INTEGER;
  previous_report_id TEXT;
BEGIN
  SELECT COUNT(*)
  INTO expected_item_count
  FROM "factory_purchase_order_items" AS item
  WHERE item."purchase_order_id" = NEW."purchase_order_id";

  SELECT COUNT(*)
  INTO reported_item_count
  FROM "factory_purchase_order_production_report_items" AS report_item
  WHERE report_item."report_id" = NEW."id"
    AND report_item."purchase_order_id" = NEW."purchase_order_id";

  IF expected_item_count = 0 OR reported_item_count <> expected_item_count THEN
    RAISE EXCEPTION 'production progress report must contain every purchase-order item';
  END IF;

  SELECT report."id"
  INTO previous_report_id
  FROM "factory_purchase_order_production_reports" AS report
  WHERE report."purchase_order_id" = NEW."purchase_order_id"
    AND report."sequence_no" < NEW."sequence_no"
  ORDER BY report."sequence_no" DESC
  LIMIT 1;

  IF previous_report_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM "factory_purchase_order_production_report_items" AS current_item
    INNER JOIN "factory_purchase_order_production_report_items" AS previous_item
      ON previous_item."report_id" = previous_report_id
      AND previous_item."purchase_order_id" = current_item."purchase_order_id"
      AND previous_item."purchase_order_item_id" = current_item."purchase_order_item_id"
    WHERE current_item."report_id" = NEW."id"
      AND current_item."completed_quantity" < previous_item."completed_quantity"
  ) THEN
    RAISE EXCEPTION 'production progress cumulative quantity cannot decrease';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "factory_purchase_order_production_report_snapshot_guard"
AFTER INSERT ON "factory_purchase_order_production_reports"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_production_report_snapshot"();

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_report_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'production progress reports are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_production_report_immutable_guard"
BEFORE UPDATE OR DELETE ON "factory_purchase_order_production_reports"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_production_report_immutable"();

CREATE TRIGGER "factory_purchase_order_production_report_item_immutable_guard"
BEFORE UPDATE OR DELETE ON "factory_purchase_order_production_report_items"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_production_report_immutable"();

COMMIT;
