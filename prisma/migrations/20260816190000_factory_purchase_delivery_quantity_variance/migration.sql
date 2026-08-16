BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

LOCK TABLE "suppliers",
           "sales_executions",
           "factory_purchase_orders",
           "factory_purchase_order_items",
           "users"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "FactoryDeliveryQuantityVarianceStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

ALTER TABLE "suppliers"
  ADD COLUMN "purchase_quantity_tolerance_ratio" DECIMAL(8,6) NOT NULL DEFAULT 0.05,
  ADD CONSTRAINT "suppliers_purchase_quantity_tolerance_ratio_check" CHECK (
    "purchase_quantity_tolerance_ratio" BETWEEN 0 AND 0.05
  );

ALTER TABLE "factory_purchase_orders"
  ADD COLUMN "delivery_quantity_tolerance_ratio" DECIMAL(8,6) NOT NULL DEFAULT 0.05,
  ADD CONSTRAINT "fpo_delivery_quantity_tolerance_ratio_check" CHECK (
    "delivery_quantity_tolerance_ratio" BETWEEN 0 AND 0.05
  );

ALTER TABLE "factory_purchase_order_items"
  ADD COLUMN "actual_delivered_quantity" DECIMAL(18,4),
  ADD CONSTRAINT "fpo_item_actual_delivered_quantity_check" CHECK (
    "actual_delivered_quantity" IS NULL OR "actual_delivered_quantity" > 0
  );

CREATE TABLE "factory_purchase_order_delivery_quantity_variances" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "status" "FactoryDeliveryQuantityVarianceStatus" NOT NULL DEFAULT 'PENDING',
  "source" "FactoryConfirmationSource" NOT NULL,
  "channel" "FactoryConfirmationChannel" NOT NULL,
  "supplier_contact" TEXT NOT NULL,
  "supplier_requested_at" TIMESTAMP(3) NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requested_by" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "decided_at" TIMESTAMP(3),
  "decided_by" TEXT,
  "decision_remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "factory_purchase_order_delivery_quantity_variances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fpo_delivery_quantity_variance_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "fpo_delivery_quantity_variance_contact_check" CHECK (
    CHAR_LENGTH(BTRIM("supplier_contact")) BETWEEN 1 AND 100
  ),
  CONSTRAINT "fpo_delivery_quantity_variance_reason_check" CHECK (
    CHAR_LENGTH(BTRIM("reason")) BETWEEN 1 AND 2000
  ),
  CONSTRAINT "fpo_delivery_quantity_variance_decision_remark_check" CHECK (
    "decision_remark" IS NULL OR CHAR_LENGTH("decision_remark") <= 2000
  ),
  CONSTRAINT "fpo_delivery_quantity_variance_decision_state_check" CHECK (
    (
      "status" = 'PENDING'
      AND "decided_at" IS NULL
      AND "decided_by" IS NULL
      AND "decision_remark" IS NULL
    ) OR (
      "status" = 'APPROVED'
      AND "decided_at" IS NOT NULL
      AND "decided_by" IS NOT NULL
    ) OR (
      "status" = 'REJECTED'
      AND "decided_at" IS NOT NULL
      AND "decided_by" IS NOT NULL
      AND NULLIF(BTRIM("decision_remark"), '') IS NOT NULL
    )
  )
);

CREATE TABLE "factory_purchase_order_delivery_quantity_variance_items" (
  "id" TEXT NOT NULL,
  "variance_id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "purchase_order_item_id" TEXT NOT NULL,
  "ordered_quantity_snapshot" DECIMAL(18,4) NOT NULL,
  "proposed_quantity" DECIMAL(18,4) NOT NULL,

  CONSTRAINT "factory_purchase_order_delivery_quantity_variance_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fpo_delivery_quantity_variance_item_quantity_check" CHECK (
    "ordered_quantity_snapshot" > 0 AND "proposed_quantity" > 0
  )
);

CREATE UNIQUE INDEX "fpo_delivery_quantity_variance_po_sequence_key"
  ON "factory_purchase_order_delivery_quantity_variances"("purchase_order_id", "sequence_no");
CREATE UNIQUE INDEX "fpo_delivery_quantity_variance_id_po_key"
  ON "factory_purchase_order_delivery_quantity_variances"("id", "purchase_order_id");
CREATE UNIQUE INDEX "fpo_delivery_quantity_variance_one_pending_key"
  ON "factory_purchase_order_delivery_quantity_variances"("purchase_order_id")
  WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "fpo_delivery_quantity_variance_one_approved_key"
  ON "factory_purchase_order_delivery_quantity_variances"("purchase_order_id")
  WHERE "status" = 'APPROVED';
CREATE INDEX "fpo_delivery_quantity_variance_po_time_idx"
  ON "factory_purchase_order_delivery_quantity_variances"("purchase_order_id", "requested_at");
CREATE INDEX "fpo_delivery_quantity_variance_requester_idx"
  ON "factory_purchase_order_delivery_quantity_variances"("requested_by");
CREATE INDEX "fpo_delivery_quantity_variance_decider_idx"
  ON "factory_purchase_order_delivery_quantity_variances"("decided_by");
CREATE UNIQUE INDEX "fpo_delivery_quantity_variance_item_line_key"
  ON "factory_purchase_order_delivery_quantity_variance_items"("variance_id", "purchase_order_item_id");
CREATE INDEX "fpo_delivery_quantity_variance_item_po_line_idx"
  ON "factory_purchase_order_delivery_quantity_variance_items"("purchase_order_id", "purchase_order_item_id");

ALTER TABLE "factory_purchase_order_delivery_quantity_variances"
  ADD CONSTRAINT "fpo_delivery_quantity_variance_purchase_order_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "factory_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_delivery_quantity_variance_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_delivery_quantity_variance_decided_by_fkey"
  FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_delivery_quantity_variance_items"
  ADD CONSTRAINT "fpo_delivery_quantity_variance_item_variance_fkey"
  FOREIGN KEY ("variance_id", "purchase_order_id")
  REFERENCES "factory_purchase_order_delivery_quantity_variances"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_delivery_quantity_variance_item_purchase_line_fkey"
  FOREIGN KEY ("purchase_order_item_id", "purchase_order_id")
  REFERENCES "factory_purchase_order_items"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The existing dispatch lock keeps commercial purchase-item fields immutable.
-- Permit only the new final-delivery fact to be filled after dispatch; its own
-- trigger and deferred snapshot constraint below validate the exact value.
CREATE OR REPLACE FUNCTION "reject_locked_factory_purchase_order_item_mutation"() RETURNS trigger AS $$
DECLARE
  old_parent_status "FactoryPurchaseOrderStatus";
  new_parent_status "FactoryPurchaseOrderStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_parent_status
      FROM "factory_purchase_orders"
      WHERE "id" = OLD."purchase_order_id"
      FOR SHARE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      IF TG_OP <> 'UPDATE'
        OR (TO_JSONB(NEW) - 'actual_delivered_quantity')
           IS DISTINCT FROM (TO_JSONB(OLD) - 'actual_delivered_quantity') THEN
        RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
      END IF;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status
      FROM "factory_purchase_orders"
      WHERE "id" = NEW."purchase_order_id"
      FOR SHARE;
    IF new_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      IF TG_OP <> 'UPDATE'
        OR (TO_JSONB(NEW) - 'actual_delivered_quantity')
           IS DISTINCT FROM (TO_JSONB(OLD) - 'actual_delivered_quantity') THEN
        RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Preserve historic delivery facts. Existing audit constraints guarantee that
-- every such order has a real internal recorder and timestamp.
UPDATE "factory_purchase_order_items" AS item
SET "actual_delivered_quantity" = item."allocated_quantity"
FROM "factory_purchase_orders" AS purchase_order
WHERE purchase_order."id" = item."purchase_order_id"
  AND purchase_order."actual_delivery_date" IS NOT NULL;

INSERT INTO "factory_purchase_order_delivery_quantity_variances" (
  "id", "purchase_order_id", "sequence_no", "status", "source", "channel",
  "supplier_contact", "supplier_requested_at", "requested_at", "requested_by",
  "reason", "decided_at", "decided_by", "decision_remark", "created_at"
)
SELECT
  'fpo-delivery-variance-' || MD5(purchase_order."id"),
  purchase_order."id",
  1,
  'APPROVED',
  'INTERNAL_OFFLINE',
  'OTHER',
  '历史交付记录',
  purchase_order."actual_delivery_recorded_at",
  purchase_order."actual_delivery_recorded_at",
  purchase_order."actual_delivery_recorded_by",
  '系统根据历史实际交付记录回填',
  purchase_order."actual_delivery_recorded_at",
  purchase_order."actual_delivery_recorded_by",
  '历史记录按原采购数量视为已批准',
  purchase_order."actual_delivery_recorded_at"
FROM "factory_purchase_orders" AS purchase_order
INNER JOIN "users" AS actor
  ON actor."id" = purchase_order."actual_delivery_recorded_by"
WHERE purchase_order."actual_delivery_date" IS NOT NULL;

INSERT INTO "factory_purchase_order_delivery_quantity_variance_items" (
  "id", "variance_id", "purchase_order_id", "purchase_order_item_id",
  "ordered_quantity_snapshot", "proposed_quantity"
)
SELECT
  'fpo-delivery-variance-item-' || MD5(item."id"),
  'fpo-delivery-variance-' || MD5(item."purchase_order_id"),
  item."purchase_order_id",
  item."id",
  item."allocated_quantity",
  item."allocated_quantity"
FROM "factory_purchase_order_items" AS item
INNER JOIN "factory_purchase_order_delivery_quantity_variances" AS variance
  ON variance."id" = 'fpo-delivery-variance-' || MD5(item."purchase_order_id")
  AND variance."purchase_order_id" = item."purchase_order_id";

CREATE OR REPLACE FUNCTION "guard_factory_delivery_quantity_tolerance_snapshot"() RETURNS trigger AS $$
BEGIN
  IF OLD."delivery_quantity_tolerance_ratio" IS DISTINCT FROM NEW."delivery_quantity_tolerance_ratio"
    AND (OLD."status" <> 'DRAFT' OR NEW."status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'dispatched factory purchase order delivery quantity tolerance is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_delivery_quantity_tolerance_guard"
BEFORE UPDATE OF "delivery_quantity_tolerance_ratio" ON "factory_purchase_orders"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_delivery_quantity_tolerance_snapshot"();

CREATE OR REPLACE FUNCTION "guard_factory_delivery_quantity_variance_insert"() RETURNS trigger AS $$
DECLARE
  purchase_order_supplier_id TEXT;
  purchase_order_status TEXT;
  purchase_order_production_status TEXT;
  production_started_at TIMESTAMP(3);
  actual_delivery_date DATE;
  shipping_started_at TIMESTAMP(3);
  expected_sequence INTEGER;
BEGIN
  SELECT purchase_order."supplier_id",
         purchase_order."status"::TEXT,
         purchase_order."production_status"::TEXT,
         purchase_order."production_started_at",
         purchase_order."actual_delivery_date",
         execution."shipping_started_at"
  INTO purchase_order_supplier_id,
       purchase_order_status,
       purchase_order_production_status,
       production_started_at,
       actual_delivery_date,
       shipping_started_at
  FROM "factory_purchase_orders" AS purchase_order
  INNER JOIN "sales_executions" AS execution
    ON execution."id" = purchase_order."execution_id"
  WHERE purchase_order."id" = NEW."purchase_order_id";

  IF purchase_order_supplier_id IS NULL
    OR purchase_order_status <> 'ACCEPTED'
    OR purchase_order_production_status <> 'IN_PRODUCTION'
    OR production_started_at IS NULL
    OR actual_delivery_date IS NOT NULL
    OR shipping_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'delivery quantity variance requires an accepted in-production undelivered purchase order';
  END IF;
  IF NEW."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'new delivery quantity variance requests must be pending';
  END IF;
  IF NEW."supplier_requested_at" < production_started_at
    OR NEW."supplier_requested_at" > NEW."requested_at"
    OR NEW."requested_at" > clock_timestamp()
    OR NEW."created_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'delivery quantity variance request time is invalid';
  END IF;

  IF NEW."source" = 'SUPPLIER_PORTAL' THEN
    IF NEW."channel" <> 'PORTAL' OR NOT EXISTS (
      SELECT 1
      FROM "users" AS requester
      WHERE requester."id" = NEW."requested_by"
        AND requester."supplier_id" = purchase_order_supplier_id
        AND requester."is_active" = TRUE
        AND requester."approval_status" = 'APPROVED'
        AND requester."deleted_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'delivery quantity variance requester is not an active operator for this supplier';
    END IF;
  ELSIF NEW."source" = 'INTERNAL_OFFLINE' THEN
    IF NEW."channel" = 'PORTAL' OR NOT EXISTS (
      SELECT 1
      FROM "users" AS requester
      WHERE requester."id" = NEW."requested_by"
        AND requester."supplier_id" IS NULL
        AND requester."is_active" = TRUE
        AND requester."approval_status" = 'APPROVED'
        AND requester."deleted_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'offline delivery quantity variance requires an active internal operator';
    END IF;
  ELSE
    RAISE EXCEPTION 'delivery quantity variance source is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "factory_purchase_order_delivery_quantity_variances" AS active_variance
    WHERE active_variance."purchase_order_id" = NEW."purchase_order_id"
      AND active_variance."status" IN ('PENDING', 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'delivery quantity variance already has an active request or approved target';
  END IF;

  SELECT COALESCE(MAX(variance."sequence_no"), 0) + 1
  INTO expected_sequence
  FROM "factory_purchase_order_delivery_quantity_variances" AS variance
  WHERE variance."purchase_order_id" = NEW."purchase_order_id";
  IF NEW."sequence_no" <> expected_sequence THEN
    RAISE EXCEPTION 'delivery quantity variance sequence is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_delivery_quantity_variance_insert_guard"
BEFORE INSERT ON "factory_purchase_order_delivery_quantity_variances"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_delivery_quantity_variance_insert"();

CREATE OR REPLACE FUNCTION "guard_factory_delivery_quantity_variance_item_insert"() RETURNS trigger AS $$
DECLARE
  allocated_quantity NUMERIC(18,4);
  tolerance_ratio NUMERIC(8,6);
  variance_status TEXT;
BEGIN
  SELECT item."allocated_quantity",
         purchase_order."delivery_quantity_tolerance_ratio",
         variance."status"::TEXT
  INTO allocated_quantity, tolerance_ratio, variance_status
  FROM "factory_purchase_order_items" AS item
  INNER JOIN "factory_purchase_orders" AS purchase_order
    ON purchase_order."id" = item."purchase_order_id"
  INNER JOIN "factory_purchase_order_delivery_quantity_variances" AS variance
    ON variance."id" = NEW."variance_id"
    AND variance."purchase_order_id" = NEW."purchase_order_id"
  WHERE item."id" = NEW."purchase_order_item_id"
    AND item."purchase_order_id" = NEW."purchase_order_id";

  IF allocated_quantity IS NULL OR variance_status <> 'PENDING' THEN
    RAISE EXCEPTION 'delivery quantity variance references an invalid pending purchase-order request';
  END IF;
  IF NEW."ordered_quantity_snapshot" <> allocated_quantity THEN
    RAISE EXCEPTION 'delivery quantity variance ordered quantity snapshot is invalid';
  END IF;
  IF ABS(NEW."proposed_quantity" - NEW."ordered_quantity_snapshot")
    > NEW."ordered_quantity_snapshot" * tolerance_ratio THEN
    RAISE EXCEPTION 'delivery quantity variance exceeds the purchase-order tolerance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_delivery_quantity_variance_item_insert_guard"
BEFORE INSERT ON "factory_purchase_order_delivery_quantity_variance_items"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_delivery_quantity_variance_item_insert"();

CREATE OR REPLACE FUNCTION "validate_factory_delivery_quantity_variance_snapshot"() RETURNS trigger AS $$
DECLARE
  expected_item_count INTEGER;
  requested_item_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO expected_item_count
  FROM "factory_purchase_order_items" AS item
  WHERE item."purchase_order_id" = NEW."purchase_order_id";

  SELECT COUNT(*)
  INTO requested_item_count
  FROM "factory_purchase_order_delivery_quantity_variance_items" AS variance_item
  WHERE variance_item."variance_id" = NEW."id"
    AND variance_item."purchase_order_id" = NEW."purchase_order_id";

  IF expected_item_count = 0 OR requested_item_count <> expected_item_count THEN
    RAISE EXCEPTION 'delivery quantity variance must contain every purchase-order item';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "factory_purchase_order_delivery_quantity_variance_items" AS variance_item
    WHERE variance_item."variance_id" = NEW."id"
      AND variance_item."proposed_quantity" <> variance_item."ordered_quantity_snapshot"
  ) THEN
    RAISE EXCEPTION 'delivery quantity variance request must contain a quantity difference';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "factory_delivery_quantity_variance_snapshot_guard"
AFTER INSERT ON "factory_purchase_order_delivery_quantity_variances"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_factory_delivery_quantity_variance_snapshot"();

CREATE OR REPLACE FUNCTION "guard_factory_delivery_quantity_variance_update"() RETURNS trigger AS $$
DECLARE
  purchase_order_status TEXT;
  purchase_order_production_status TEXT;
  actual_delivery_date DATE;
  shipping_started_at TIMESTAMP(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'delivery quantity variance requests are immutable';
  END IF;
  IF OLD."status" <> 'PENDING'
    OR NEW."status" NOT IN ('APPROVED', 'REJECTED')
    OR (TO_JSONB(NEW) - ARRAY['status', 'decided_at', 'decided_by', 'decision_remark'])
       IS DISTINCT FROM (TO_JSONB(OLD) - ARRAY['status', 'decided_at', 'decided_by', 'decision_remark']) THEN
    RAISE EXCEPTION 'delivery quantity variance request history is immutable';
  END IF;

  SELECT purchase_order."status"::TEXT,
         purchase_order."production_status"::TEXT,
         purchase_order."actual_delivery_date",
         execution."shipping_started_at"
  INTO purchase_order_status,
       purchase_order_production_status,
       actual_delivery_date,
       shipping_started_at
  FROM "factory_purchase_orders" AS purchase_order
  INNER JOIN "sales_executions" AS execution
    ON execution."id" = purchase_order."execution_id"
  WHERE purchase_order."id" = NEW."purchase_order_id";

  IF purchase_order_status <> 'ACCEPTED'
    OR purchase_order_production_status <> 'IN_PRODUCTION'
    OR actual_delivery_date IS NOT NULL
    OR shipping_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'delivery quantity variance can no longer be decided';
  END IF;
  IF NEW."decided_at" < OLD."requested_at"
    OR NEW."decided_at" > clock_timestamp()
    OR NOT EXISTS (
      SELECT 1
      FROM "users" AS decider
      WHERE decider."id" = NEW."decided_by"
        AND decider."supplier_id" IS NULL
        AND decider."is_active" = TRUE
        AND decider."approval_status" = 'APPROVED'
        AND decider."deleted_at" IS NULL
    ) THEN
    RAISE EXCEPTION 'delivery quantity variance decision actor or time is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_delivery_quantity_variance_update_guard"
BEFORE UPDATE OR DELETE ON "factory_purchase_order_delivery_quantity_variances"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_delivery_quantity_variance_update"();

CREATE OR REPLACE FUNCTION "guard_factory_delivery_quantity_variance_item_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'delivery quantity variance items are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_delivery_quantity_variance_item_immutable_guard"
BEFORE UPDATE OR DELETE ON "factory_purchase_order_delivery_quantity_variance_items"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_delivery_quantity_variance_item_immutable"();

-- A pending variance must be decided before the purchase order can leave
-- production. Otherwise the decision guard (IN_PRODUCTION only) and actual
-- delivery guard would leave the order permanently stuck.
CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_pending_variance_completion"() RETURNS trigger AS $$
BEGIN
  IF NEW."production_status" = 'COMPLETED'
    AND OLD."production_status" IS DISTINCT FROM NEW."production_status"
    AND EXISTS (
      SELECT 1
      FROM "factory_purchase_order_delivery_quantity_variances" AS variance
      WHERE variance."purchase_order_id" = NEW."id"
        AND variance."status" = 'PENDING'
    ) THEN
    RAISE EXCEPTION 'pending delivery quantity variance must be decided before production completion';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_pending_variance_completion_guard"
BEFORE UPDATE OF "production_status" ON "factory_purchase_orders"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_pending_variance_completion"();

-- This replaces the original allocated-quantity ceiling. The approved request
-- becomes the production target; without one, the contractual allocation stays
-- authoritative. Application services are intentionally wired in a later step.
CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_report_item"() RETURNS trigger AS $$
DECLARE
  target_quantity NUMERIC(18,4);
  previous_completed_quantity NUMERIC(18,4);
  allowed_quantity NUMERIC(18,4);
BEGIN
  SELECT COALESCE(approved_item."proposed_quantity", item."allocated_quantity")
  INTO target_quantity
  FROM "factory_purchase_order_items" AS item
  LEFT JOIN "factory_purchase_order_delivery_quantity_variances" AS approved
    ON approved."purchase_order_id" = item."purchase_order_id"
    AND approved."status" = 'APPROVED'
  LEFT JOIN "factory_purchase_order_delivery_quantity_variance_items" AS approved_item
    ON approved_item."variance_id" = approved."id"
    AND approved_item."purchase_order_id" = approved."purchase_order_id"
    AND approved_item."purchase_order_item_id" = item."id"
  WHERE item."id" = NEW."purchase_order_item_id"
    AND item."purchase_order_id" = NEW."purchase_order_id";

  IF target_quantity IS NULL THEN
    RAISE EXCEPTION 'production progress references an invalid purchase-order item';
  END IF;

  SELECT previous_item."completed_quantity"
  INTO previous_completed_quantity
  FROM "factory_purchase_order_production_reports" AS current_report
  INNER JOIN "factory_purchase_order_production_reports" AS previous_report
    ON previous_report."purchase_order_id" = current_report."purchase_order_id"
    AND previous_report."sequence_no" < current_report."sequence_no"
  INNER JOIN "factory_purchase_order_production_report_items" AS previous_item
    ON previous_item."report_id" = previous_report."id"
    AND previous_item."purchase_order_id" = previous_report."purchase_order_id"
    AND previous_item."purchase_order_item_id" = NEW."purchase_order_item_id"
  WHERE current_report."id" = NEW."report_id"
    AND current_report."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY previous_report."sequence_no" DESC
  LIMIT 1;

  allowed_quantity := GREATEST(target_quantity, COALESCE(previous_completed_quantity, 0));
  IF NEW."completed_quantity" > allowed_quantity THEN
    RAISE EXCEPTION 'production completed quantity exceeds the approved delivery target';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_actual_delivered_quantity"() RETURNS trigger AS $$
DECLARE
  approved_quantity NUMERIC(18,4);
  expected_quantity NUMERIC(18,4);
BEGIN
  IF OLD."actual_delivered_quantity" IS NOT NULL
    AND NEW."actual_delivered_quantity" IS DISTINCT FROM OLD."actual_delivered_quantity" THEN
    RAISE EXCEPTION 'actual factory delivered quantity is immutable';
  END IF;
  IF NEW."actual_delivered_quantity" IS NOT NULL
    AND OLD."actual_delivered_quantity" IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM "factory_purchase_order_delivery_quantity_variances" AS pending
      WHERE pending."purchase_order_id" = NEW."purchase_order_id"
        AND pending."status" = 'PENDING'
    ) THEN
      RAISE EXCEPTION 'pending delivery quantity variance must be decided before actual delivery';
    END IF;
    SELECT variance_item."proposed_quantity"
    INTO approved_quantity
    FROM "factory_purchase_order_delivery_quantity_variances" AS variance
    INNER JOIN "factory_purchase_order_delivery_quantity_variance_items" AS variance_item
      ON variance_item."variance_id" = variance."id"
      AND variance_item."purchase_order_id" = variance."purchase_order_id"
    WHERE variance."purchase_order_id" = NEW."purchase_order_id"
      AND variance."status" = 'APPROVED'
      AND variance_item."purchase_order_item_id" = NEW."id";

    expected_quantity := COALESCE(approved_quantity, NEW."allocated_quantity");
    IF NEW."actual_delivered_quantity" <> expected_quantity THEN
      RAISE EXCEPTION 'actual delivered quantity does not match the approved delivery target';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_actual_delivered_quantity_guard"
BEFORE UPDATE OF "actual_delivered_quantity" ON "factory_purchase_order_items"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_actual_delivered_quantity"();

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_actual_delivery_quantities"() RETURNS trigger AS $$
DECLARE
  parent_id TEXT;
  parent_actual_delivery_date DATE;
  item_count INTEGER;
  actual_quantity_count INTEGER;
  pending_variance_count INTEGER;
BEGIN
  parent_id := CASE
    WHEN TG_TABLE_NAME = 'factory_purchase_orders' THEN TO_JSONB(NEW) ->> 'id'
    ELSE TO_JSONB(NEW) ->> 'purchase_order_id'
  END;
  SELECT purchase_order."actual_delivery_date"
  INTO parent_actual_delivery_date
  FROM "factory_purchase_orders" AS purchase_order
  WHERE purchase_order."id" = parent_id;

  SELECT COUNT(*), COUNT(item."actual_delivered_quantity")
  INTO item_count, actual_quantity_count
  FROM "factory_purchase_order_items" AS item
  WHERE item."purchase_order_id" = parent_id;

  SELECT COUNT(*)
  INTO pending_variance_count
  FROM "factory_purchase_order_delivery_quantity_variances" AS variance
  WHERE variance."purchase_order_id" = parent_id
    AND variance."status" = 'PENDING';

  IF pending_variance_count <> 0
    AND (parent_actual_delivery_date IS NOT NULL OR actual_quantity_count <> 0) THEN
    RAISE EXCEPTION 'pending delivery quantity variance must be decided before actual delivery';
  END IF;

  IF parent_actual_delivery_date IS NULL AND actual_quantity_count <> 0 THEN
    RAISE EXCEPTION 'actual delivered quantities require an actual delivery date';
  END IF;
  IF parent_actual_delivery_date IS NOT NULL
    AND (item_count = 0 OR actual_quantity_count <> item_count) THEN
    RAISE EXCEPTION 'actual delivery must contain every purchase-order item quantity';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "factory_purchase_order_actual_delivery_quantity_parent_guard"
AFTER UPDATE OF "actual_delivery_date" ON "factory_purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_actual_delivery_quantities"();

CREATE CONSTRAINT TRIGGER "factory_purchase_order_actual_delivery_quantity_item_guard"
AFTER UPDATE OF "actual_delivered_quantity" ON "factory_purchase_order_items"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_actual_delivery_quantities"();

-- Forward-replace the shipping anchor guard so direct SQL cannot bypass the
-- actual-delivery quantity rules enforced by the application. The original
-- actor, state, immutability and row-lock rules remain intact.
CREATE OR REPLACE FUNCTION "protect_sales_execution_shipping_anchor"() RETURNS trigger AS $$
DECLARE
  active_purchase_order_count INTEGER;
  invalid_purchase_order_count INTEGER;
  missing_actual_quantity_count INTEGER;
  short_execution_item_count INTEGER;
BEGIN
  IF OLD."shipping_started_at" IS NOT NULL AND (
    NEW."shipping_started_at" IS DISTINCT FROM OLD."shipping_started_at"
    OR NEW."shipping_started_by" IS DISTINCT FROM OLD."shipping_started_by"
    OR NEW."status" IS DISTINCT FROM OLD."status"
  ) THEN
    RAISE EXCEPTION 'sales execution shipping handoff is immutable';
  END IF;
  IF OLD."shipping_started_at" IS NULL AND NEW."shipping_started_at" IS NOT NULL THEN
    IF NEW."status" <> 'DISPATCHED'::"SalesExecutionStatus"
      OR NOT EXISTS (
        SELECT 1 FROM "users" actor
        WHERE actor."id" = NEW."shipping_started_by"
          AND actor."supplier_id" IS NULL
          AND actor."is_active" = TRUE
          AND actor."approval_status" = 'APPROVED'
          AND actor."deleted_at" IS NULL
      ) THEN
      RAISE EXCEPTION 'shipping requires a dispatched execution and an active approved internal actor';
    END IF;

    PERFORM purchase_order."id"
    FROM "factory_purchase_orders" purchase_order
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" <> 'VOIDED'
    ORDER BY purchase_order."id"
    FOR UPDATE;

    PERFORM item."id"
    FROM "factory_purchase_order_items" item
    INNER JOIN "factory_purchase_orders" purchase_order
      ON purchase_order."id" = item."purchase_order_id"
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" <> 'VOIDED'
    ORDER BY item."id"
    FOR UPDATE OF item;

    SELECT COUNT(*), COUNT(*) FILTER (
      WHERE purchase_order."status" <> 'ACCEPTED'
        OR purchase_order."production_status" <> 'COMPLETED'
        OR purchase_order."production_completed_at" IS NULL
        OR purchase_order."production_completed_by" IS NULL
        OR purchase_order."actual_delivery_date" IS NULL
        OR EXISTS (
          SELECT 1
          FROM "factory_purchase_order_delivery_quantity_variances" variance
          WHERE variance."purchase_order_id" = purchase_order."id"
            AND variance."status" = 'PENDING'
        )
    )
    INTO active_purchase_order_count, invalid_purchase_order_count
    FROM "factory_purchase_orders" purchase_order
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" <> 'VOIDED';
    IF active_purchase_order_count = 0 OR invalid_purchase_order_count <> 0 THEN
      RAISE EXCEPTION 'shipping requires every active factory purchase order to be accepted, completed and delivered';
    END IF;

    SELECT COUNT(*)
    INTO missing_actual_quantity_count
    FROM "factory_purchase_order_items" item
    INNER JOIN "factory_purchase_orders" purchase_order
      ON purchase_order."id" = item."purchase_order_id"
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" <> 'VOIDED'
      AND item."actual_delivered_quantity" IS NULL;
    IF missing_actual_quantity_count <> 0 THEN
      RAISE EXCEPTION 'shipping requires every active purchase-order item actual delivered quantity';
    END IF;

    SELECT COUNT(*)
    INTO short_execution_item_count
    FROM "sales_execution_items" execution_item
    LEFT JOIN (
      SELECT item."execution_item_id",
             SUM(item."actual_delivered_quantity") AS delivered_quantity
      FROM "factory_purchase_order_items" item
      INNER JOIN "factory_purchase_orders" purchase_order
        ON purchase_order."id" = item."purchase_order_id"
      WHERE purchase_order."execution_id" = NEW."id"
        AND purchase_order."status" <> 'VOIDED'
      GROUP BY item."execution_item_id"
    ) delivered ON delivered."execution_item_id" = execution_item."id"
    WHERE execution_item."execution_id" = NEW."id"
      AND COALESCE(delivered.delivered_quantity, 0) < execution_item."quantity";
    IF short_execution_item_count <> 0 THEN
      RAISE EXCEPTION 'shipping actual delivered quantity does not cover every sales execution item';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Forward-only settlement reconstruction. Historical settlement snapshots stay
-- untouched. New settlements pay the actual delivered line quantities at the
-- effective frozen unit price, while delay penalties remain anchored to the
-- original contractual penalty_base_amount.
CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_settlement_insert"() RETURNS trigger AS $$
DECLARE
  target_execution_id TEXT;
  purchase_order RECORD;
  delivery_item_count INTEGER;
  missing_delivery_quantity_count INTEGER;
  missing_effective_price_count INTEGER;
  expected_delivery_base NUMERIC(18,2);
  provisional_adjustment_count INTEGER;
  invalid_adjustment_currency_count INTEGER;
  ordinary_increase NUMERIC(18,2);
  ordinary_decrease NUMERIC(18,2);
  delay_adjustment_count INTEGER;
  invalid_delay_adjustment_count INTEGER;
  delay_adjustment_amount NUMERIC(18,2);
  confirmed_paid NUMERIC(18,2);
  expected_delay_days INTEGER;
  uncapped_delay_penalty NUMERIC(18,2);
  expected_delay_penalty NUMERIC(18,2);
  expected_final_payable NUMERIC(18,2);
BEGIN
  SELECT purchase_order_row."execution_id"
  INTO target_execution_id
  FROM "factory_purchase_orders" AS purchase_order_row
  WHERE purchase_order_row."id" = NEW."purchase_order_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory settlement purchase order does not exist';
  END IF;

  PERFORM execution."id"
  FROM "sales_executions" AS execution
  WHERE execution."id" = target_execution_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory settlement sales execution does not exist';
  END IF;

  SELECT purchase_order_row."status",
         purchase_order_row."production_status",
         purchase_order_row."production_completed_at",
         purchase_order_row."purchase_currency",
         purchase_order_row."penalty_base_amount",
         purchase_order_row."initial_supplier_delivery_date",
         purchase_order_row."actual_delivery_date",
         purchase_order_row."delay_grace_days",
         purchase_order_row."delay_penalty_rate_per_day",
         purchase_order_row."delay_penalty_cap_ratio",
         execution."shipping_started_at"
  INTO purchase_order
  FROM "factory_purchase_orders" AS purchase_order_row
  INNER JOIN "sales_executions" AS execution
    ON execution."id" = purchase_order_row."execution_id"
  WHERE purchase_order_row."id" = NEW."purchase_order_id"
    AND purchase_order_row."execution_id" = target_execution_id
  FOR UPDATE OF purchase_order_row;

  IF NOT FOUND
    OR purchase_order."status" <> 'ACCEPTED'
    OR purchase_order."production_status" <> 'COMPLETED'
    OR purchase_order."production_completed_at" IS NULL
    OR purchase_order."actual_delivery_date" IS NULL
    OR purchase_order."shipping_started_at" IS NULL THEN
    RAISE EXCEPTION 'factory settlement requires a delivered completed purchase order in shipping';
  END IF;
  IF purchase_order."penalty_base_amount" IS NULL
    OR purchase_order."initial_supplier_delivery_date" IS NULL
    OR purchase_order."delay_grace_days" < 0
    OR purchase_order."delay_penalty_rate_per_day" < 0
    OR purchase_order."delay_penalty_cap_ratio" < 0 THEN
    RAISE EXCEPTION 'factory settlement purchase order terms are incomplete or invalid';
  END IF;

  PERFORM item."id"
  FROM "factory_purchase_order_items" AS item
  WHERE item."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY item."line_number", item."id"
  FOR UPDATE;
  PERFORM supplier_price."id"
  FROM "factory_purchase_order_supplier_prices" AS supplier_price
  WHERE supplier_price."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY supplier_price."purchase_order_item_id", supplier_price."id"
  FOR SHARE;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE item."actual_delivered_quantity" IS NULL),
         COUNT(*) FILTER (
           WHERE COALESCE(supplier_price."unit_price", item."purchase_unit_price") IS NULL
         ),
         COALESCE(SUM(ROUND(
           item."actual_delivered_quantity"
             * COALESCE(supplier_price."unit_price", item."purchase_unit_price"),
           2
         )), 0)::NUMERIC(18,2)
  INTO delivery_item_count,
       missing_delivery_quantity_count,
       missing_effective_price_count,
       expected_delivery_base
  FROM "factory_purchase_order_items" AS item
  LEFT JOIN "factory_purchase_order_supplier_prices" AS supplier_price
    ON supplier_price."purchase_order_item_id" = item."id"
    AND supplier_price."purchase_order_id" = item."purchase_order_id"
  WHERE item."purchase_order_id" = NEW."purchase_order_id";

  IF delivery_item_count = 0 OR missing_delivery_quantity_count <> 0 THEN
    RAISE EXCEPTION 'factory settlement requires every actual delivered item quantity';
  END IF;
  IF missing_effective_price_count <> 0 THEN
    RAISE EXCEPTION 'factory settlement requires every effective purchase unit price';
  END IF;
  IF NEW."currency" IS DISTINCT FROM purchase_order."purchase_currency"
    OR NEW."base_amount" IS DISTINCT FROM expected_delivery_base THEN
    RAISE EXCEPTION 'factory settlement currency or actual delivery base does not match the purchase order';
  END IF;
  IF NEW."exchange_rate" <= 0
    OR (NEW."currency" = 'CNY' AND NEW."exchange_rate" <> 1) THEN
    RAISE EXCEPTION 'factory settlement exchange rate is invalid';
  END IF;

  PERFORM payment."id"
  FROM "factory_purchase_order_payments" AS payment
  WHERE payment."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY payment."sequence_no", payment."id"
  FOR UPDATE;
  PERFORM adjustment."id"
  FROM "factory_purchase_order_adjustments" AS adjustment
  WHERE adjustment."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY adjustment."sequence_no", adjustment."id"
  FOR UPDATE;

  SELECT COUNT(*) FILTER (WHERE adjustment."status" = 'PROVISIONAL'),
         COUNT(*) FILTER (
           WHERE adjustment."status" = 'CONFIRMED'
             AND adjustment."currency" IS DISTINCT FROM purchase_order."purchase_currency"
         ),
         COALESCE(SUM(adjustment."amount") FILTER (
           WHERE adjustment."status" = 'CONFIRMED'
             AND adjustment."kind" <> 'DELAY_PENALTY'
             AND adjustment."direction" = 'INCREASE'
         ), 0),
         COALESCE(SUM(adjustment."amount") FILTER (
           WHERE adjustment."status" = 'CONFIRMED'
             AND adjustment."kind" <> 'DELAY_PENALTY'
             AND adjustment."direction" = 'DECREASE'
         ), 0),
         COUNT(*) FILTER (
           WHERE adjustment."status" = 'CONFIRMED'
             AND adjustment."kind" = 'DELAY_PENALTY'
         ),
         COUNT(*) FILTER (
           WHERE adjustment."status" = 'CONFIRMED'
             AND adjustment."kind" = 'DELAY_PENALTY'
             AND (
               adjustment."direction" <> 'DECREASE'
               OR adjustment."currency" IS DISTINCT FROM purchase_order."purchase_currency"
             )
         ),
         COALESCE(SUM(adjustment."amount") FILTER (
           WHERE adjustment."status" = 'CONFIRMED'
             AND adjustment."kind" = 'DELAY_PENALTY'
         ), 0)
  INTO provisional_adjustment_count,
       invalid_adjustment_currency_count,
       ordinary_increase,
       ordinary_decrease,
       delay_adjustment_count,
       invalid_delay_adjustment_count,
       delay_adjustment_amount
  FROM "factory_purchase_order_adjustments" AS adjustment
  WHERE adjustment."purchase_order_id" = NEW."purchase_order_id";

  IF provisional_adjustment_count <> 0 THEN
    RAISE EXCEPTION 'factory settlement requires every active adjustment to be confirmed';
  END IF;
  IF invalid_adjustment_currency_count <> 0 THEN
    RAISE EXCEPTION 'factory settlement adjustment currency does not match the purchase order';
  END IF;
  IF NEW."increase_amount" IS DISTINCT FROM ordinary_increase
    OR NEW."decrease_amount" IS DISTINCT FROM ordinary_decrease THEN
    RAISE EXCEPTION 'factory settlement ordinary adjustment totals do not match the ledger';
  END IF;

  expected_delay_days := GREATEST(
    purchase_order."actual_delivery_date"
      - purchase_order."initial_supplier_delivery_date"
      - purchase_order."delay_grace_days",
    0
  );
  uncapped_delay_penalty := ROUND(
    purchase_order."penalty_base_amount"
      * purchase_order."delay_penalty_rate_per_day"
      * expected_delay_days,
    2
  );
  expected_delay_penalty := CASE
    WHEN purchase_order."delay_penalty_cap_ratio" IS NULL THEN uncapped_delay_penalty
    ELSE LEAST(
      uncapped_delay_penalty,
      ROUND(purchase_order."penalty_base_amount" * purchase_order."delay_penalty_cap_ratio", 2)
    )
  END;

  IF NEW."delay_days" IS DISTINCT FROM expected_delay_days
    OR NEW."delay_penalty_amount" IS DISTINCT FROM expected_delay_penalty THEN
    RAISE EXCEPTION 'factory settlement delay calculation does not match the frozen purchase terms';
  END IF;
  IF expected_delay_penalty > 0 AND (
    delay_adjustment_count <> 1
    OR invalid_delay_adjustment_count <> 0
    OR delay_adjustment_amount IS DISTINCT FROM expected_delay_penalty
  ) THEN
    RAISE EXCEPTION 'factory settlement requires one matching confirmed delay deduction';
  END IF;
  IF expected_delay_penalty = 0 AND delay_adjustment_count <> 0 THEN
    RAISE EXCEPTION 'factory settlement contains an unexpected delay deduction';
  END IF;

  expected_final_payable := ROUND(
    expected_delivery_base
      + ordinary_increase
      - ordinary_decrease
      - expected_delay_penalty,
    2
  );
  IF expected_final_payable < 0
    OR NEW."final_payable_amount" IS DISTINCT FROM expected_final_payable THEN
    RAISE EXCEPTION 'factory settlement final payable does not match the actual delivery ledger';
  END IF;

  SELECT COALESCE(SUM(payment."amount"), 0)
  INTO confirmed_paid
  FROM "factory_purchase_order_payments" AS payment
  WHERE payment."purchase_order_id" = NEW."purchase_order_id"
    AND payment."status" = 'CONFIRMED';
  IF NEW."paid_amount_at_settlement" IS DISTINCT FROM confirmed_paid THEN
    RAISE EXCEPTION 'factory settlement paid amount does not match confirmed purchase payments';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
