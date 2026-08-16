BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';
LOCK TABLE "sales_executions", "factory_purchase_orders", "factory_purchase_order_items",
  "factory_purchase_order_production_reports", "factory_purchase_order_production_report_items",
  "factory_purchase_order_delivery_quantity_variances",
  "factory_purchase_order_delivery_quantity_variance_items",
  "factory_purchase_order_settlements", "users"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "SalesExecutionContainerLoadStatus" AS ENUM ('DRAFT', 'OPEN', 'RELEASED', 'VOIDED');
CREATE TYPE "FactoryPurchaseLoadingResultStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "FactoryPurchaseLoadingReason" AS ENUM ('EXACT', 'WEIGHT_LIMIT', 'VOLUME_LIMIT', 'OTHER');

CREATE TABLE "sales_execution_container_loads" (
  "id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "status" "SalesExecutionContainerLoadStatus" NOT NULL DEFAULT 'DRAFT',
  "container_no" TEXT,
  "container_type" TEXT,
  "seal_no" TEXT,
  "loading_date" DATE,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "released_at" TIMESTAMP(3),
  "released_by" TEXT,
  "release_remark" TEXT,
  "voided_at" TIMESTAMP(3),
  "voided_by" TEXT,
  "void_reason" TEXT,
  "legacy_backfill" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_execution_container_loads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "container_load_sequence_revision_check" CHECK ("sequence_no" > 0 AND "revision" > 0),
  CONSTRAINT "container_load_text_check" CHECK (
    ("container_no" IS NULL OR LENGTH(BTRIM("container_no")) BETWEEN 1 AND 100)
    AND ("container_type" IS NULL OR LENGTH(BTRIM("container_type")) BETWEEN 1 AND 100)
    AND ("seal_no" IS NULL OR LENGTH(BTRIM("seal_no")) BETWEEN 1 AND 100)
    AND ("release_remark" IS NULL OR LENGTH(BTRIM("release_remark")) BETWEEN 1 AND 2000)
    AND ("void_reason" IS NULL OR LENGTH(BTRIM("void_reason")) BETWEEN 1 AND 2000)
  ),
  CONSTRAINT "container_load_state_audit_check" CHECK (
    ("status" IN ('DRAFT', 'OPEN') AND "released_at" IS NULL AND "released_by" IS NULL
      AND "release_remark" IS NULL
      AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
    OR ("status" = 'RELEASED' AND "loading_date" IS NOT NULL
      AND "released_at" IS NOT NULL AND "released_by" IS NOT NULL
      AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
    OR ("status" = 'VOIDED' AND "released_at" IS NULL AND "released_by" IS NULL
      AND "release_remark" IS NULL
      AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)
  )
);

CREATE TABLE "container_load_allocations" (
  "id" TEXT NOT NULL,
  "container_load_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "purchase_order_item_id" TEXT NOT NULL,
  "planned_quantity" DECIMAL(18,4) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "container_load_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "container_load_allocation_quantity_check" CHECK ("planned_quantity" > 0)
);

CREATE TABLE "factory_purchase_order_loading_results" (
  "id" TEXT NOT NULL,
  "container_load_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "status" "FactoryPurchaseLoadingResultStatus" NOT NULL DEFAULT 'PENDING',
  "reason" "FactoryPurchaseLoadingReason" NOT NULL,
  "reason_detail" TEXT,
  "source" "FactoryConfirmationSource" NOT NULL,
  "channel" "FactoryConfirmationChannel" NOT NULL,
  "supplier_contact" TEXT NOT NULL,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requested_by" TEXT NOT NULL,
  "decided_at" TIMESTAMP(3),
  "decided_by" TEXT,
  "decision_remark" TEXT,
  "legacy_backfill" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "factory_purchase_order_loading_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fpo_loading_result_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "fpo_loading_result_contact_check" CHECK (LENGTH(BTRIM("supplier_contact")) BETWEEN 1 AND 100),
  CONSTRAINT "fpo_loading_result_reason_detail_check" CHECK (
    "reason_detail" IS NULL OR LENGTH(BTRIM("reason_detail")) BETWEEN 1 AND 2000
  ),
  CONSTRAINT "fpo_loading_result_decision_remark_check" CHECK (
    "decision_remark" IS NULL OR LENGTH(BTRIM("decision_remark")) BETWEEN 1 AND 2000
  ),
  CONSTRAINT "fpo_loading_result_other_reason_check" CHECK (
    "legacy_backfill" = TRUE OR "reason" <> 'OTHER' OR "reason_detail" IS NOT NULL
  ),
  CONSTRAINT "fpo_loading_result_decision_state_check" CHECK (
    ("status" = 'PENDING' AND "decided_at" IS NULL AND "decided_by" IS NULL AND "decision_remark" IS NULL)
    OR ("status" IN ('APPROVED', 'REJECTED') AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL)
  )
);

CREATE TABLE "factory_purchase_order_loading_result_items" (
  "id" TEXT NOT NULL,
  "loading_result_id" TEXT NOT NULL,
  "container_load_id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "purchase_order_item_id" TEXT NOT NULL,
  "planned_quantity_snapshot" DECIMAL(18,4) NOT NULL,
  "delivery_target_quantity_snapshot" DECIMAL(18,4) NOT NULL,
  "completed_quantity_snapshot" DECIMAL(18,4) NOT NULL,
  "previously_approved_loaded_quantity_snapshot" DECIMAL(18,4) NOT NULL,
  "loaded_quantity" DECIMAL(18,4) NOT NULL,
  "cumulative_approved_loaded_quantity_snapshot" DECIMAL(18,4) NOT NULL,
  "warehouse_retained_quantity_snapshot" DECIMAL(18,4) NOT NULL,
  CONSTRAINT "factory_purchase_order_loading_result_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fpo_loading_result_item_quantity_check" CHECK (
    "planned_quantity_snapshot" > 0
    AND "delivery_target_quantity_snapshot" > 0
    AND "completed_quantity_snapshot" > 0
    AND "completed_quantity_snapshot" >= "delivery_target_quantity_snapshot"
    AND "previously_approved_loaded_quantity_snapshot" >= 0
    AND "loaded_quantity" >= 0
    AND "cumulative_approved_loaded_quantity_snapshot"
      = "previously_approved_loaded_quantity_snapshot" + "loaded_quantity"
    AND "cumulative_approved_loaded_quantity_snapshot" <= "delivery_target_quantity_snapshot"
    AND "cumulative_approved_loaded_quantity_snapshot" <= "completed_quantity_snapshot"
    AND "warehouse_retained_quantity_snapshot"
      = "completed_quantity_snapshot" - "cumulative_approved_loaded_quantity_snapshot"
    AND "warehouse_retained_quantity_snapshot" >= 0
  )
);

CREATE UNIQUE INDEX "container_load_execution_sequence_key"
  ON "sales_execution_container_loads"("execution_id", "sequence_no");
CREATE UNIQUE INDEX "container_load_id_execution_key"
  ON "sales_execution_container_loads"("id", "execution_id");
CREATE UNIQUE INDEX "container_load_execution_container_no_key"
  ON "sales_execution_container_loads"("execution_id", "container_no");
CREATE INDEX "container_load_execution_status_idx"
  ON "sales_execution_container_loads"("execution_id", "status", "updated_at");
CREATE INDEX "container_load_released_by_idx" ON "sales_execution_container_loads"("released_by");
CREATE INDEX "container_load_voided_by_idx" ON "sales_execution_container_loads"("voided_by");

CREATE UNIQUE INDEX "container_load_allocation_container_line_key"
  ON "container_load_allocations"("container_load_id", "purchase_order_item_id");
CREATE UNIQUE INDEX "container_load_allocation_slot_line_key"
  ON "container_load_allocations"("container_load_id", "purchase_order_id", "purchase_order_item_id");
CREATE INDEX "container_load_allocation_po_line_idx"
  ON "container_load_allocations"("purchase_order_id", "purchase_order_item_id");
CREATE INDEX "container_load_allocation_execution_po_idx"
  ON "container_load_allocations"("execution_id", "purchase_order_id");

CREATE UNIQUE INDEX "fpo_loading_result_slot_sequence_key"
  ON "factory_purchase_order_loading_results"("container_load_id", "purchase_order_id", "sequence_no");
CREATE UNIQUE INDEX "fpo_loading_result_id_slot_key"
  ON "factory_purchase_order_loading_results"("id", "container_load_id", "purchase_order_id");
CREATE UNIQUE INDEX "fpo_loading_result_one_pending_per_po_key"
  ON "factory_purchase_order_loading_results"("purchase_order_id") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "fpo_loading_result_one_approved_per_slot_key"
  ON "factory_purchase_order_loading_results"("container_load_id", "purchase_order_id")
  WHERE "status" = 'APPROVED';
CREATE INDEX "fpo_loading_result_po_time_idx"
  ON "factory_purchase_order_loading_results"("purchase_order_id", "requested_at");
CREATE INDEX "fpo_loading_result_slot_status_idx"
  ON "factory_purchase_order_loading_results"("container_load_id", "purchase_order_id", "status");
CREATE INDEX "fpo_loading_result_execution_container_idx"
  ON "factory_purchase_order_loading_results"("execution_id", "container_load_id");
CREATE INDEX "fpo_loading_result_requester_idx" ON "factory_purchase_order_loading_results"("requested_by");
CREATE INDEX "fpo_loading_result_decider_idx" ON "factory_purchase_order_loading_results"("decided_by");
CREATE UNIQUE INDEX "fpo_loading_result_item_line_key"
  ON "factory_purchase_order_loading_result_items"("loading_result_id", "purchase_order_item_id");
CREATE INDEX "fpo_loading_result_item_allocation_idx"
  ON "factory_purchase_order_loading_result_items"("container_load_id", "purchase_order_id", "purchase_order_item_id");
CREATE INDEX "fpo_loading_result_item_po_line_idx"
  ON "factory_purchase_order_loading_result_items"("purchase_order_id", "purchase_order_item_id");

ALTER TABLE "sales_execution_container_loads"
  ADD CONSTRAINT "container_load_execution_fkey" FOREIGN KEY ("execution_id")
    REFERENCES "sales_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "container_load_released_by_fkey" FOREIGN KEY ("released_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "container_load_voided_by_fkey" FOREIGN KEY ("voided_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "container_load_allocations"
  ADD CONSTRAINT "container_load_allocation_container_fkey"
    FOREIGN KEY ("container_load_id", "execution_id")
    REFERENCES "sales_execution_container_loads"("id", "execution_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "container_load_allocation_purchase_order_fkey"
    FOREIGN KEY ("purchase_order_id", "execution_id")
    REFERENCES "factory_purchase_orders"("id", "execution_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "container_load_allocation_purchase_line_fkey"
    FOREIGN KEY ("purchase_order_item_id", "purchase_order_id")
    REFERENCES "factory_purchase_order_items"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_loading_results"
  ADD CONSTRAINT "fpo_loading_result_container_fkey"
    FOREIGN KEY ("container_load_id", "execution_id")
    REFERENCES "sales_execution_container_loads"("id", "execution_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_loading_result_purchase_order_fkey"
    FOREIGN KEY ("purchase_order_id", "execution_id")
    REFERENCES "factory_purchase_orders"("id", "execution_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_loading_result_requested_by_fkey" FOREIGN KEY ("requested_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_loading_result_decided_by_fkey" FOREIGN KEY ("decided_by")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_loading_result_items"
  ADD CONSTRAINT "fpo_loading_result_item_result_fkey"
    FOREIGN KEY ("loading_result_id", "container_load_id", "purchase_order_id")
    REFERENCES "factory_purchase_order_loading_results"("id", "container_load_id", "purchase_order_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_loading_result_item_allocation_fkey"
    FOREIGN KEY ("container_load_id", "purchase_order_id", "purchase_order_item_id")
    REFERENCES "container_load_allocations"("container_load_id", "purchase_order_id", "purchase_order_item_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_loading_result_item_purchase_line_fkey"
    FOREIGN KEY ("purchase_order_item_id", "purchase_order_id")
    REFERENCES "factory_purchase_order_items"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Historical actual-delivery facts are preserved as one released legacy load
-- per historical purchase order.  All legacy quantities deliberately use the
-- known actual quantity for plan, target and completion so retained stock stays
-- zero; the migration does not claim that no physical stock remained.
WITH historic AS (
  SELECT purchase_order.*,
    ROW_NUMBER() OVER (
      PARTITION BY purchase_order."execution_id"
      ORDER BY purchase_order."actual_delivery_date", purchase_order."id"
    ) AS legacy_sequence
  FROM "factory_purchase_orders" AS purchase_order
  WHERE purchase_order."actual_delivery_date" IS NOT NULL
    AND purchase_order."actual_delivery_recorded_at" IS NOT NULL
    AND purchase_order."actual_delivery_recorded_by" IS NOT NULL
)
INSERT INTO "sales_execution_container_loads" (
  "id", "execution_id", "sequence_no", "status", "loading_date", "revision",
  "released_at", "released_by", "release_remark", "legacy_backfill", "created_at", "updated_at"
)
SELECT 'legacy-container-load-' || MD5(historic."id"), historic."execution_id",
  historic.legacy_sequence, 'RELEASED', historic."actual_delivery_date", 1,
  historic."actual_delivery_recorded_at", historic."actual_delivery_recorded_by",
  'LEGACY：根据历史实际交付记录建立兼容柜总单，未推断真实柜号或留仓数量',
  TRUE, historic."actual_delivery_recorded_at", historic."actual_delivery_recorded_at"
FROM historic
INNER JOIN "users" AS actor ON actor."id" = historic."actual_delivery_recorded_by";

INSERT INTO "container_load_allocations" (
  "id", "container_load_id", "execution_id", "purchase_order_id",
  "purchase_order_item_id", "planned_quantity", "created_at"
)
SELECT 'legacy-container-allocation-' || MD5(item."id"),
  'legacy-container-load-' || MD5(item."purchase_order_id"), item."execution_id",
  item."purchase_order_id", item."id", item."actual_delivered_quantity",
  purchase_order."actual_delivery_recorded_at"
FROM "factory_purchase_order_items" AS item
INNER JOIN "factory_purchase_orders" AS purchase_order ON purchase_order."id" = item."purchase_order_id"
WHERE purchase_order."actual_delivery_date" IS NOT NULL
  AND item."actual_delivered_quantity" IS NOT NULL;

INSERT INTO "factory_purchase_order_loading_results" (
  "id", "container_load_id", "execution_id", "purchase_order_id", "sequence_no",
  "status", "reason", "reason_detail", "source", "channel", "supplier_contact",
  "requested_at", "requested_by", "decided_at", "decided_by", "decision_remark",
  "legacy_backfill", "created_at"
)
SELECT 'legacy-loading-result-' || MD5(purchase_order."id"),
  'legacy-container-load-' || MD5(purchase_order."id"), purchase_order."execution_id",
  purchase_order."id", 1, 'APPROVED', 'EXACT',
  'LEGACY：系统按历史已知实际交付数量建立贡献快照，未推断真实留仓数量',
  'INTERNAL_OFFLINE', 'OTHER', 'LEGACY 历史实际交付记录',
  purchase_order."actual_delivery_recorded_at", purchase_order."actual_delivery_recorded_by",
  purchase_order."actual_delivery_recorded_at", purchase_order."actual_delivery_recorded_by",
  'LEGACY 历史记录按已知实际交付数量批准', TRUE,
  purchase_order."actual_delivery_recorded_at"
FROM "factory_purchase_orders" AS purchase_order
INNER JOIN "users" AS actor ON actor."id" = purchase_order."actual_delivery_recorded_by"
WHERE purchase_order."actual_delivery_date" IS NOT NULL;

INSERT INTO "factory_purchase_order_loading_result_items" (
  "id", "loading_result_id", "container_load_id", "purchase_order_id", "purchase_order_item_id",
  "planned_quantity_snapshot", "delivery_target_quantity_snapshot", "completed_quantity_snapshot",
  "previously_approved_loaded_quantity_snapshot", "loaded_quantity",
  "cumulative_approved_loaded_quantity_snapshot", "warehouse_retained_quantity_snapshot"
)
SELECT 'legacy-loading-result-item-' || MD5(item."id"),
  'legacy-loading-result-' || MD5(item."purchase_order_id"),
  'legacy-container-load-' || MD5(item."purchase_order_id"), item."purchase_order_id", item."id",
  item."actual_delivered_quantity", item."actual_delivered_quantity", item."actual_delivered_quantity",
  0, item."actual_delivered_quantity", item."actual_delivered_quantity", 0
FROM "factory_purchase_order_items" AS item
INNER JOIN "factory_purchase_orders" AS purchase_order ON purchase_order."id" = item."purchase_order_id"
WHERE purchase_order."actual_delivery_date" IS NOT NULL
  AND item."actual_delivered_quantity" IS NOT NULL;

CREATE OR REPLACE FUNCTION "guard_sales_execution_container_load_insert"() RETURNS trigger AS $$
DECLARE
  execution_status "SalesExecutionStatus";
  expected_sequence INTEGER;
BEGIN
  IF NEW."legacy_backfill" = TRUE OR NEW."status" <> 'DRAFT'
    OR NEW."released_at" IS NOT NULL OR NEW."released_by" IS NOT NULL
    OR NEW."release_remark" IS NOT NULL
    OR NEW."voided_at" IS NOT NULL OR NEW."voided_by" IS NOT NULL THEN
    RAISE EXCEPTION 'new container load must begin as a non-legacy draft';
  END IF;
  SELECT execution."status" INTO execution_status
  FROM "sales_executions" AS execution
  WHERE execution."id" = NEW."execution_id" FOR UPDATE;
  IF NOT FOUND OR execution_status = 'VOIDED' THEN
    RAISE EXCEPTION 'container load requires an active sales execution';
  END IF;
  SELECT COALESCE(MAX(load."sequence_no"), 0) + 1 INTO expected_sequence
  FROM "sales_execution_container_loads" AS load
  WHERE load."execution_id" = NEW."execution_id";
  IF NEW."sequence_no" <> expected_sequence THEN
    RAISE EXCEPTION 'container load sequence must be contiguous within the sales execution';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_execution_container_load_insert_guard"
BEFORE INSERT ON "sales_execution_container_loads"
FOR EACH ROW EXECUTE FUNCTION "guard_sales_execution_container_load_insert"();

CREATE OR REPLACE FUNCTION "guard_container_load_allocation_change"() RETURNS trigger AS $$
DECLARE
  load_status "SalesExecutionContainerLoadStatus";
  old_load_status "SalesExecutionContainerLoadStatus";
  purchase_status "FactoryPurchaseOrderStatus";
  execution_shipping_started_at TIMESTAMP(3);
  target_quantity NUMERIC(18,4);
  reserved_quantity NUMERIC(24,4);
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT load."status" INTO load_status
    FROM "sales_execution_container_loads" AS load
    WHERE load."id" = OLD."container_load_id" FOR UPDATE;
  ELSE
    SELECT load."status" INTO load_status
    FROM "sales_execution_container_loads" AS load
    WHERE load."id" = NEW."container_load_id" FOR UPDATE;
  END IF;
  IF NOT FOUND OR load_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'container allocations may only change while the load is draft';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."container_load_id" IS DISTINCT FROM NEW."container_load_id" THEN
    SELECT load."status" INTO old_load_status
    FROM "sales_execution_container_loads" AS load
    WHERE load."id" = OLD."container_load_id" FOR UPDATE;
    IF NOT FOUND OR old_load_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'container allocations cannot be moved out of a non-draft load';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT purchase_order."status", execution."shipping_started_at",
         COALESCE(approved_item."proposed_quantity", item."allocated_quantity")
  INTO purchase_status, execution_shipping_started_at, target_quantity
  FROM "factory_purchase_order_items" AS item
  INNER JOIN "factory_purchase_orders" AS purchase_order
    ON purchase_order."id" = item."purchase_order_id"
    AND purchase_order."execution_id" = NEW."execution_id"
  INNER JOIN "sales_executions" AS execution ON execution."id" = purchase_order."execution_id"
  LEFT JOIN "factory_purchase_order_delivery_quantity_variances" AS approved
    ON approved."purchase_order_id" = item."purchase_order_id" AND approved."status" = 'APPROVED'
  LEFT JOIN "factory_purchase_order_delivery_quantity_variance_items" AS approved_item
    ON approved_item."variance_id" = approved."id"
    AND approved_item."purchase_order_id" = approved."purchase_order_id"
    AND approved_item."purchase_order_item_id" = item."id"
  WHERE item."id" = NEW."purchase_order_item_id"
    AND item."purchase_order_id" = NEW."purchase_order_id"
  FOR UPDATE OF item;
  IF NOT FOUND OR purchase_status <> 'ACCEPTED' OR execution_shipping_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'container allocation requires an accepted purchase order before shipping';
  END IF;

  SELECT COALESCE(SUM(
    CASE WHEN approved_result."id" IS NOT NULL THEN COALESCE(approved_item."loaded_quantity", 0)
         ELSE allocation."planned_quantity" END
  ), 0)
  INTO reserved_quantity
  FROM "container_load_allocations" AS allocation
  INNER JOIN "sales_execution_container_loads" AS load ON load."id" = allocation."container_load_id"
  LEFT JOIN "factory_purchase_order_loading_results" AS approved_result
    ON approved_result."container_load_id" = allocation."container_load_id"
    AND approved_result."purchase_order_id" = allocation."purchase_order_id"
    AND approved_result."status" = 'APPROVED'
  LEFT JOIN "factory_purchase_order_loading_result_items" AS approved_item
    ON approved_item."loading_result_id" = approved_result."id"
    AND approved_item."purchase_order_item_id" = allocation."purchase_order_item_id"
  WHERE allocation."purchase_order_item_id" = NEW."purchase_order_item_id"
    AND load."status" <> 'VOIDED'
    AND allocation."id" <> NEW."id";
  IF reserved_quantity + NEW."planned_quantity" > target_quantity THEN
    RAISE EXCEPTION 'container plans exceed the approved delivery target for this purchase line';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "container_load_allocation_change_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "container_load_allocations"
FOR EACH ROW EXECUTE FUNCTION "guard_container_load_allocation_change"();

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_loading_result_insert"() RETURNS trigger AS $$
DECLARE
  parent RECORD;
  requester RECORD;
  expected_sequence INTEGER;
BEGIN
  IF NEW."legacy_backfill" = TRUE
    OR NEW."status" <> 'PENDING'
    OR NEW."decided_at" IS NOT NULL
    OR NEW."decided_by" IS NOT NULL THEN
    RAISE EXCEPTION 'new loading result must begin pending and cannot be a legacy backfill';
  END IF;

  SELECT purchase_order."status", purchase_order."production_status",
         purchase_order."supplier_id", execution."shipping_started_at",
         load."status" AS load_status, load."execution_id" AS load_execution_id,
         settlement."id" AS settlement_id
  INTO parent
  FROM "factory_purchase_orders" AS purchase_order
  INNER JOIN "sales_executions" AS execution
    ON execution."id" = purchase_order."execution_id"
  INNER JOIN "sales_execution_container_loads" AS load
    ON load."id" = NEW."container_load_id"
  LEFT JOIN "factory_purchase_order_settlements" AS settlement
    ON settlement."purchase_order_id" = purchase_order."id"
  WHERE purchase_order."id" = NEW."purchase_order_id"
  FOR UPDATE OF purchase_order;

  IF NOT FOUND
    OR parent."status" <> 'ACCEPTED'
    OR parent."production_status" <> 'COMPLETED'
    OR parent.load_status <> 'OPEN'
    OR parent.load_execution_id <> NEW."execution_id"
    OR parent."shipping_started_at" IS NOT NULL
    OR parent."settlement_id" IS NOT NULL
    OR NEW."requested_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'loading result requires an open container and completed purchase order before shipping';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "container_load_allocations" AS allocation
    WHERE allocation."container_load_id" = NEW."container_load_id"
      AND allocation."purchase_order_id" = NEW."purchase_order_id"
  ) THEN
    RAISE EXCEPTION 'loading result requires an allocation slot for this purchase order';
  END IF;

  SELECT actor."supplier_id", actor."role", actor."is_active",
         actor."approval_status", actor."deleted_at"
  INTO requester
  FROM "users" AS actor
  WHERE actor."id" = NEW."requested_by"
  FOR KEY SHARE;
  IF NOT FOUND OR requester."is_active" <> TRUE
    OR requester."approval_status" <> 'APPROVED'
    OR requester."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'loading result requester is not an active approved actor';
  END IF;
  IF NEW."source" = 'SUPPLIER_PORTAL' AND (
      requester."supplier_id" IS DISTINCT FROM parent."supplier_id"
      OR requester."role" NOT IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
      OR NEW."channel" <> 'PORTAL'
    ) THEN
    RAISE EXCEPTION 'supplier loading result must come from the bound supplier portal';
  END IF;
  IF NEW."source" = 'INTERNAL_OFFLINE' AND (
      requester."supplier_id" IS NOT NULL
      OR requester."role" IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
      OR NEW."channel" = 'PORTAL'
    ) THEN
    RAISE EXCEPTION 'offline loading result must be recorded by an internal actor';
  END IF;

  SELECT COALESCE(MAX(result."sequence_no"), 0) + 1
  INTO expected_sequence
  FROM "factory_purchase_order_loading_results" AS result
  WHERE result."container_load_id" = NEW."container_load_id"
    AND result."purchase_order_id" = NEW."purchase_order_id";
  IF NEW."sequence_no" <> expected_sequence THEN
    RAISE EXCEPTION 'loading result sequence must be contiguous';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_loading_result_insert_guard"
BEFORE INSERT ON "factory_purchase_order_loading_results"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_loading_result_insert"();

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_loading_result_item_insert"() RETURNS trigger AS $$
DECLARE
  parent_status "FactoryPurchaseLoadingResultStatus";
  parent_legacy BOOLEAN;
  parent_container_status "SalesExecutionContainerLoadStatus";
  expected_planned NUMERIC(18,4);
  expected_target NUMERIC(18,4);
  expected_completed NUMERIC(18,4);
  expected_previous NUMERIC(18,4);
  reserved_by_other_loads NUMERIC(24,4);
BEGIN
  SELECT result."status", result."legacy_backfill", load."status"
  INTO parent_status, parent_legacy, parent_container_status
  FROM "factory_purchase_order_loading_results" AS result
  INNER JOIN "sales_execution_container_loads" AS load ON load."id" = result."container_load_id"
  WHERE result."id" = NEW."loading_result_id"
    AND result."container_load_id" = NEW."container_load_id"
    AND result."purchase_order_id" = NEW."purchase_order_id"
  FOR KEY SHARE;
  IF NOT FOUND OR parent_status <> 'PENDING' OR parent_legacy = TRUE OR parent_container_status <> 'OPEN' THEN
    RAISE EXCEPTION 'loading result items may only be appended to a pending non-legacy result';
  END IF;

  SELECT allocation."planned_quantity" INTO expected_planned
  FROM "container_load_allocations" AS allocation
  WHERE allocation."container_load_id" = NEW."container_load_id"
    AND allocation."purchase_order_id" = NEW."purchase_order_id"
    AND allocation."purchase_order_item_id" = NEW."purchase_order_item_id"
  FOR KEY SHARE;
  IF NOT FOUND OR NEW."planned_quantity_snapshot" <> expected_planned THEN
    RAISE EXCEPTION 'loading result planned quantity snapshot does not match the container allocation';
  END IF;

  SELECT COALESCE(approved_item."proposed_quantity", item."allocated_quantity")
  INTO expected_target
  FROM "factory_purchase_order_items" AS item
  LEFT JOIN "factory_purchase_order_delivery_quantity_variances" AS approved
    ON approved."purchase_order_id" = item."purchase_order_id"
    AND approved."status" = 'APPROVED'
  LEFT JOIN "factory_purchase_order_delivery_quantity_variance_items" AS approved_item
    ON approved_item."variance_id" = approved."id"
    AND approved_item."purchase_order_id" = approved."purchase_order_id"
    AND approved_item."purchase_order_item_id" = item."id"
  WHERE item."id" = NEW."purchase_order_item_id"
    AND item."purchase_order_id" = NEW."purchase_order_id"
  FOR KEY SHARE OF item;
  IF NOT FOUND OR NEW."delivery_target_quantity_snapshot" <> expected_target THEN
    RAISE EXCEPTION 'loading result delivery target snapshot does not match the approved target';
  END IF;

  SELECT progress_item."completed_quantity"
  INTO expected_completed
  FROM "factory_purchase_order_production_reports" AS report
  INNER JOIN "factory_purchase_order_production_report_items" AS progress_item
    ON progress_item."report_id" = report."id"
    AND progress_item."purchase_order_id" = report."purchase_order_id"
  WHERE report."purchase_order_id" = NEW."purchase_order_id"
    AND progress_item."purchase_order_item_id" = NEW."purchase_order_item_id"
  ORDER BY report."sequence_no" DESC
  LIMIT 1;
  IF NOT FOUND OR NEW."completed_quantity_snapshot" <> expected_completed THEN
    RAISE EXCEPTION 'loading result completed quantity snapshot does not match final production progress';
  END IF;
  SELECT COALESCE(SUM(
    CASE WHEN approved_result."id" IS NOT NULL THEN COALESCE(approved_item."loaded_quantity", 0)
         ELSE allocation."planned_quantity" END
  ), 0)
  INTO reserved_by_other_loads
  FROM "container_load_allocations" AS allocation
  INNER JOIN "sales_execution_container_loads" AS load ON load."id" = allocation."container_load_id"
  LEFT JOIN "factory_purchase_order_loading_results" AS approved_result
    ON approved_result."container_load_id" = allocation."container_load_id"
    AND approved_result."purchase_order_id" = allocation."purchase_order_id"
    AND approved_result."status" = 'APPROVED'
  LEFT JOIN "factory_purchase_order_loading_result_items" AS approved_item
    ON approved_item."loading_result_id" = approved_result."id"
    AND approved_item."purchase_order_item_id" = allocation."purchase_order_item_id"
  WHERE allocation."purchase_order_item_id" = NEW."purchase_order_item_id"
    AND load."status" <> 'VOIDED'
    AND allocation."container_load_id" <> NEW."container_load_id";
  SELECT COALESCE(SUM(approved_item."loaded_quantity"), 0)
  INTO expected_previous
  FROM "factory_purchase_order_loading_results" AS approved_result
  INNER JOIN "factory_purchase_order_loading_result_items" AS approved_item
    ON approved_item."loading_result_id" = approved_result."id"
  WHERE approved_result."purchase_order_id" = NEW."purchase_order_id"
    AND approved_result."status" = 'APPROVED'
    AND approved_item."purchase_order_item_id" = NEW."purchase_order_item_id";
  IF NEW."previously_approved_loaded_quantity_snapshot" <> expected_previous
    OR NEW."cumulative_approved_loaded_quantity_snapshot" <> expected_previous + NEW."loaded_quantity"
    OR NEW."cumulative_approved_loaded_quantity_snapshot" > expected_target
    OR NEW."cumulative_approved_loaded_quantity_snapshot" > expected_completed
    OR reserved_by_other_loads + NEW."loaded_quantity" > expected_target
    OR NEW."warehouse_retained_quantity_snapshot"
       <> expected_completed - NEW."cumulative_approved_loaded_quantity_snapshot" THEN
    RAISE EXCEPTION 'loading result cumulative quantities or effective container reservations exceed the approved target';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_loading_result_item_insert_guard"
BEFORE INSERT ON "factory_purchase_order_loading_result_items"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_loading_result_item_insert"();

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_loading_result_snapshot"() RETURNS trigger AS $$
DECLARE
  allocation_item_count INTEGER;
  result_item_count INTEGER;
  different_item_count INTEGER;
  result_reason "FactoryPurchaseLoadingReason";
  result_status "FactoryPurchaseLoadingResultStatus";
BEGIN
  SELECT result."reason", result."status"
  INTO result_reason, result_status
  FROM "factory_purchase_order_loading_results" AS result
  WHERE result."id" = NEW."id";

  SELECT COUNT(*) INTO allocation_item_count
  FROM "container_load_allocations" AS allocation
  WHERE allocation."container_load_id" = NEW."container_load_id"
    AND allocation."purchase_order_id" = NEW."purchase_order_id";

  SELECT COUNT(*),
         COUNT(*) FILTER (
           WHERE item."loaded_quantity" <> item."planned_quantity_snapshot"
         )
  INTO result_item_count, different_item_count
  FROM "factory_purchase_order_loading_result_items" AS item
  WHERE item."loading_result_id" = NEW."id"
    AND item."purchase_order_id" = NEW."purchase_order_id";

  IF allocation_item_count = 0 OR result_item_count <> allocation_item_count THEN
    RAISE EXCEPTION 'loading result must contain every allocated item in this container and purchase-order slot';
  END IF;
  IF result_reason = 'EXACT' AND different_item_count <> 0 THEN
    RAISE EXCEPTION 'exact loading result must match every container allocation';
  END IF;
  IF result_reason = 'EXACT' AND result_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'exact loading result must be approved in the creation transaction';
  END IF;
  IF result_reason <> 'EXACT' AND different_item_count = 0 THEN
    RAISE EXCEPTION 'non-exact loading result must differ from a container allocation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "factory_purchase_order_loading_result_snapshot_guard"
AFTER INSERT ON "factory_purchase_order_loading_results"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_loading_result_snapshot"();

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_loading_result_update"() RETURNS trigger AS $$
DECLARE
  decider RECORD;
  parent RECORD;
  exact_self_approval BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'loading result history is append-only';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'decided loading result is immutable';
  END IF;
  IF NEW."status" NOT IN ('APPROVED', 'REJECTED')
    OR NEW."decided_at" IS NULL
    OR NEW."decided_by" IS NULL
    OR NEW."decided_at" < OLD."requested_at"
    OR NEW."decided_at" > clock_timestamp()
    OR (NEW."status" = 'REJECTED' AND NEW."decision_remark" IS NULL)
    OR (TO_JSONB(NEW) - ARRAY['status', 'decided_at', 'decided_by', 'decision_remark'])
       IS DISTINCT FROM
       (TO_JSONB(OLD) - ARRAY['status', 'decided_at', 'decided_by', 'decision_remark']) THEN
    RAISE EXCEPTION 'loading result decision transition is invalid';
  END IF;

  IF NEW."status" = 'APPROVED' THEN
    SELECT purchase_order."status", purchase_order."production_status", execution."shipping_started_at",
           load."status" AS load_status,
           settlement."id" AS settlement_id
    INTO parent
    FROM "factory_purchase_orders" AS purchase_order
    INNER JOIN "sales_executions" AS execution
      ON execution."id" = purchase_order."execution_id"
    INNER JOIN "sales_execution_container_loads" AS load ON load."id" = OLD."container_load_id"
    LEFT JOIN "factory_purchase_order_settlements" AS settlement
      ON settlement."purchase_order_id" = purchase_order."id"
    WHERE purchase_order."id" = OLD."purchase_order_id"
    FOR UPDATE OF purchase_order;
    IF NOT FOUND OR parent."status" <> 'ACCEPTED'
      OR parent."production_status" <> 'COMPLETED'
      OR parent.load_status <> 'OPEN'
      OR parent."shipping_started_at" IS NOT NULL
      OR parent."settlement_id" IS NOT NULL THEN
      RAISE EXCEPTION 'loading result approval requires an open container and completed active purchase order';
    END IF;
  END IF;

  SELECT actor."supplier_id", actor."role", actor."is_active",
         actor."approval_status", actor."deleted_at"
  INTO decider
  FROM "users" AS actor
  WHERE actor."id" = NEW."decided_by"
  FOR KEY SHARE;
  exact_self_approval := OLD."reason" = 'EXACT'
    AND NEW."status" = 'APPROVED'
    AND NEW."decided_by" = OLD."requested_by";
  IF NOT FOUND OR decider."is_active" <> TRUE
    OR decider."approval_status" <> 'APPROVED'
    OR decider."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'loading result must be decided by an active approved actor';
  END IF;
  IF exact_self_approval IS NOT TRUE AND (
      decider."supplier_id" IS NOT NULL
      OR decider."role" IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
    ) THEN
    RAISE EXCEPTION 'non-exact loading result must be decided by an internal actor';
  END IF;
  IF OLD."reason" <> 'EXACT'
    AND OLD."source" = 'INTERNAL_OFFLINE'
    AND NEW."decided_by" = OLD."requested_by" THEN
    RAISE EXCEPTION 'offline loading result requester and decider must be different actors';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_loading_result_update_guard"
BEFORE UPDATE OR DELETE ON "factory_purchase_order_loading_results"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_loading_result_update"();

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_loading_result_item_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'loading result item history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_loading_result_item_immutable_guard"
BEFORE UPDATE OR DELETE ON "factory_purchase_order_loading_result_items"
FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_loading_result_item_immutable"();

CREATE OR REPLACE FUNCTION "guard_sales_execution_container_load_update"() RETURNS trigger AS $$
DECLARE
  actor_valid BOOLEAN;
  allocation_count INTEGER;
  slot_count INTEGER;
  approved_slot_count INTEGER;
  pending_count INTEGER;
  total_loaded NUMERIC(24,4);
  latest_completion_date DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'container load history is append-only'; END IF;
  IF OLD."status" IN ('RELEASED', 'VOIDED') THEN
    RAISE EXCEPTION 'released or voided container load is immutable';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1
    OR NEW."execution_id" IS DISTINCT FROM OLD."execution_id"
    OR NEW."sequence_no" IS DISTINCT FROM OLD."sequence_no"
    OR NEW."legacy_backfill" IS DISTINCT FROM OLD."legacy_backfill"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."updated_at" < OLD."updated_at"
    OR NEW."updated_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'container load revision or immutable identity is invalid';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF (TO_JSONB(NEW) - ARRAY[
      'container_no', 'container_type', 'seal_no', 'loading_date', 'revision', 'updated_at'
    ]) IS DISTINCT FROM (TO_JSONB(OLD) - ARRAY[
      'container_no', 'container_type', 'seal_no', 'loading_date', 'revision', 'updated_at'
    ]) THEN
      RAISE EXCEPTION 'draft container update may only change header fields';
    END IF;
  ELSIF OLD."status" = 'DRAFT' AND NEW."status" = 'OPEN' THEN
    IF (TO_JSONB(NEW) - ARRAY[
      'status', 'container_no', 'container_type', 'seal_no', 'loading_date', 'revision', 'updated_at'
    ]) IS DISTINCT FROM (TO_JSONB(OLD) - ARRAY[
      'status', 'container_no', 'container_type', 'seal_no', 'loading_date', 'revision', 'updated_at'
    ]) THEN
      RAISE EXCEPTION 'opening a container may only finalize header fields';
    END IF;
  ELSIF OLD."status" = 'OPEN' AND NEW."status" = 'OPEN' THEN
    IF (TO_JSONB(NEW) - ARRAY['revision', 'updated_at'])
       IS DISTINCT FROM (TO_JSONB(OLD) - ARRAY['revision', 'updated_at']) THEN
      RAISE EXCEPTION 'open container header is frozen; only revision may advance';
    END IF;
  ELSIF OLD."status" = 'OPEN' AND NEW."status" = 'RELEASED' THEN
    IF (TO_JSONB(NEW) - ARRAY[
      'status', 'revision', 'updated_at', 'released_at', 'released_by', 'release_remark'
    ]) IS DISTINCT FROM (TO_JSONB(OLD) - ARRAY[
      'status', 'revision', 'updated_at', 'released_at', 'released_by', 'release_remark'
    ]) THEN
      RAISE EXCEPTION 'releasing a container may only set release audit fields';
    END IF;
  ELSIF OLD."status" IN ('DRAFT', 'OPEN') AND NEW."status" = 'VOIDED' THEN
    IF (TO_JSONB(NEW) - ARRAY[
      'status', 'revision', 'updated_at', 'voided_at', 'voided_by', 'void_reason'
    ]) IS DISTINCT FROM (TO_JSONB(OLD) - ARRAY[
      'status', 'revision', 'updated_at', 'voided_at', 'voided_by', 'void_reason'
    ]) THEN
      RAISE EXCEPTION 'voiding a container may only set void audit fields';
    END IF;
  ELSE
    RAISE EXCEPTION 'container load state transition is invalid';
  END IF;

  IF NEW."status" = 'OPEN' AND OLD."status" = 'DRAFT' THEN
    SELECT COUNT(*) INTO allocation_count FROM "container_load_allocations"
    WHERE "container_load_id" = NEW."id";
    IF NULLIF(BTRIM(NEW."container_no"), '') IS NULL
      OR NEW."loading_date" IS NULL
      OR allocation_count = 0 THEN
      RAISE EXCEPTION 'container load requires a container number, loading date and allocations before opening';
    END IF;
  END IF;

  IF NEW."status" = 'VOIDED' AND OLD."status" IS DISTINCT FROM 'VOIDED' THEN
    SELECT TRUE INTO actor_valid FROM "users" AS actor
    WHERE actor."id" = NEW."voided_by" AND actor."supplier_id" IS NULL
      AND actor."is_active" = TRUE AND actor."approval_status" = 'APPROVED'
      AND actor."deleted_at" IS NULL FOR KEY SHARE;
    IF COALESCE(actor_valid, false) IS NOT TRUE OR EXISTS (
      SELECT 1 FROM "factory_purchase_order_loading_results" AS result
      WHERE result."container_load_id" = NEW."id" AND result."status" IN ('PENDING', 'APPROVED')
    ) OR NEW."voided_at" IS NULL
      OR NEW."voided_at" < OLD."created_at"
      OR NEW."voided_at" > clock_timestamp() THEN
      RAISE EXCEPTION 'only an internal actor may void a container without pending or approved contributions';
    END IF;
  END IF;

  IF NEW."status" = 'RELEASED' AND OLD."status" = 'OPEN' THEN
    SELECT TRUE INTO actor_valid FROM "users" AS actor
    WHERE actor."id" = NEW."released_by" AND actor."supplier_id" IS NULL
      AND actor."is_active" = TRUE AND actor."approval_status" = 'APPROVED'
      AND actor."deleted_at" IS NULL FOR KEY SHARE;
    SELECT COUNT(*), COUNT(DISTINCT allocation."purchase_order_id")
    INTO allocation_count, slot_count
    FROM "container_load_allocations" AS allocation WHERE allocation."container_load_id" = NEW."id";
    SELECT COUNT(DISTINCT result."id"), COALESCE(SUM(item."loaded_quantity"), 0)
    INTO approved_slot_count, total_loaded
    FROM "factory_purchase_order_loading_results" AS result
    LEFT JOIN "factory_purchase_order_loading_result_items" AS item
      ON item."loading_result_id" = result."id"
    WHERE result."container_load_id" = NEW."id" AND result."status" = 'APPROVED';
    SELECT COUNT(*) INTO pending_count
    FROM "factory_purchase_order_loading_results" AS pending
    WHERE pending."status" = 'PENDING'
      AND pending."container_load_id" = NEW."id";
    SELECT MAX((purchase_order."production_completed_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::DATE)
    INTO latest_completion_date
    FROM "factory_purchase_orders" AS purchase_order WHERE purchase_order."id" IN (
      SELECT allocation."purchase_order_id" FROM "container_load_allocations" AS allocation
      WHERE allocation."container_load_id" = NEW."id"
    );
    IF COALESCE(actor_valid, false) IS NOT TRUE OR allocation_count = 0
      OR approved_slot_count <> slot_count OR pending_count <> 0 OR total_loaded <= 0
      OR NEW."loading_date" < latest_completion_date
      OR NEW."loading_date" > (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::DATE
      OR NEW."released_at" IS NULL
      OR NEW."released_at" < OLD."created_at"
      OR NEW."released_at" > clock_timestamp() THEN
      RAISE EXCEPTION 'container release requires internal approval, complete approved slots and positive total loading';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_execution_container_load_update_guard"
BEFORE UPDATE OR DELETE ON "sales_execution_container_loads"
FOR EACH ROW EXECUTE FUNCTION "guard_sales_execution_container_load_update"();

-- Forward-replace the purchase-order workflow guard. Actual delivery remains
-- a compatibility cache, but it is now written once by shipping handoff from
-- every RELEASED container contribution. Supplier approval and container
-- release themselves never write that cache.
CREATE OR REPLACE FUNCTION "protect_supplier_factory_purchase_order_completion"() RETURNS trigger AS $$
DECLARE
  completion_actor_valid BOOLEAN := false;
  legacy_actual_cache_reset BOOLEAN := false;
  legacy_completion_actor RECORD;
  required_prepayment DECIMAL(18,2);
  paid_prepayment DECIMAL(18,2);
BEGIN
  IF OLD."production_status" IS DISTINCT FROM 'COMPLETED'
    AND NEW."production_status" = 'COMPLETED'
    AND NEW."production_completion_source" IS NULL THEN
    SELECT completion_user."supplier_id", completion_user."name"
    INTO legacy_completion_actor
    FROM "users" completion_user
    WHERE completion_user."id" = NEW."production_completed_by";
    IF FOUND THEN
      NEW."production_completion_source" := CASE
        WHEN legacy_completion_actor."supplier_id" IS NOT DISTINCT FROM NEW."supplier_id"
          THEN 'SUPPLIER_PORTAL'::"FactoryConfirmationSource"
        ELSE 'INTERNAL_OFFLINE'::"FactoryConfirmationSource"
      END;
      NEW."production_completion_channel" := CASE
        WHEN legacy_completion_actor."supplier_id" IS NOT DISTINCT FROM NEW."supplier_id"
          THEN 'PORTAL'::"FactoryConfirmationChannel"
        ELSE 'OTHER'::"FactoryConfirmationChannel"
      END;
      NEW."production_completion_contact" := LEFT(
        COALESCE(NULLIF(BTRIM(legacy_completion_actor."name"), ''), '历史确认人'),
        100
      );
      NEW."production_completion_recorded_at" := NEW."production_completed_at";
    END IF;
  END IF;
  IF OLD."replacement_for_id" IS NOT NULL
    AND NEW."replacement_for_id" IS DISTINCT FROM OLD."replacement_for_id" THEN
    RAISE EXCEPTION 'purchase order replacement link is immutable';
  END IF;
  IF OLD."production_status" = 'COMPLETED' THEN
    IF NEW."production_status" IS DISTINCT FROM OLD."production_status"
      OR NEW."production_started_at" IS DISTINCT FROM OLD."production_started_at"
      OR NEW."production_started_by" IS DISTINCT FROM OLD."production_started_by"
      OR NEW."production_completed_at" IS DISTINCT FROM OLD."production_completed_at"
      OR NEW."production_completed_by" IS DISTINCT FROM OLD."production_completed_by"
      OR NEW."production_completion_source" IS DISTINCT FROM OLD."production_completion_source"
      OR NEW."production_completion_channel" IS DISTINCT FROM OLD."production_completion_channel"
      OR NEW."production_completion_contact" IS DISTINCT FROM OLD."production_completion_contact"
      OR NEW."production_completion_recorded_at" IS DISTINCT FROM OLD."production_completion_recorded_at"
      OR NEW."production_completion_remark" IS DISTINCT FROM OLD."production_completion_remark"
      OR NEW."production_completion_evidence_note" IS DISTINCT FROM OLD."production_completion_evidence_note"
      OR NEW."supplier_delivery_date" IS DISTINCT FROM OLD."supplier_delivery_date"
      OR NEW."confirmed_supplier_delivery_date" IS DISTINCT FROM OLD."confirmed_supplier_delivery_date"
      OR NEW."initial_supplier_delivery_date" IS DISTINCT FROM OLD."initial_supplier_delivery_date"
      OR NEW."supplier_response_sequence" IS DISTINCT FROM OLD."supplier_response_sequence"
      OR NEW."supplier_response_remark" IS DISTINCT FROM OLD."supplier_response_remark"
      OR NEW."responded_at" IS DISTINCT FROM OLD."responded_at"
      OR NEW."responded_by" IS DISTINCT FROM OLD."responded_by" THEN
      RAISE EXCEPTION 'completed factory purchase order production and delivery terms are immutable';
    END IF;
  END IF;

  -- Actual delivery is a one-time materialized cache written by the shipping
  -- handoff after every relevant container has been released.
  IF OLD."actual_delivery_date" IS NOT NULL THEN
    legacy_actual_cache_reset := NEW."actual_delivery_date" IS NULL
      AND NEW."actual_delivery_recorded_at" IS NULL
      AND NEW."actual_delivery_recorded_by" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "sales_execution_container_loads" AS legacy_load
        INNER JOIN "container_load_allocations" AS legacy_allocation
          ON legacy_allocation."container_load_id" = legacy_load."id"
        INNER JOIN "sales_executions" AS execution ON execution."id" = legacy_load."execution_id"
        WHERE legacy_allocation."purchase_order_id" = OLD."id"
          AND legacy_load."status" = 'RELEASED'
          AND legacy_load."legacy_backfill" = TRUE
          AND execution."shipping_started_at" IS NULL
      );
  END IF;
  IF OLD."actual_delivery_date" IS NOT NULL AND legacy_actual_cache_reset IS NOT TRUE AND (
    NEW."actual_delivery_date" IS DISTINCT FROM OLD."actual_delivery_date"
    OR NEW."actual_delivery_recorded_at" IS DISTINCT FROM OLD."actual_delivery_recorded_at"
    OR NEW."actual_delivery_recorded_by" IS DISTINCT FROM OLD."actual_delivery_recorded_by"
  ) THEN
    RAISE EXCEPTION 'shipping materialized actual factory delivery cache is immutable';
  END IF;
  IF OLD."actual_delivery_date" IS NULL AND NEW."actual_delivery_date" IS NOT NULL AND (
    OLD."production_status" <> 'COMPLETED'
    OR NEW."actual_delivery_date" < (
      OLD."production_completed_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai'
    )::DATE
    OR NEW."actual_delivery_date" > (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::DATE
    OR NEW."actual_delivery_recorded_at" IS NULL
    OR NEW."actual_delivery_recorded_by" IS NULL
  ) THEN
    RAISE EXCEPTION 'actual factory delivery cache must advance from a completed purchase order';
  END IF;

  IF OLD."production_status" = 'IN_PRODUCTION'
    AND NEW."production_status" NOT IN ('IN_PRODUCTION', 'COMPLETED') THEN
    RAISE EXCEPTION 'in-progress factory purchase order production cannot move backwards';
  END IF;
  IF NEW."production_status" IS DISTINCT FROM OLD."production_status"
    AND NEW."production_status" = 'READY'
    AND OLD."production_status" = 'WAITING_PREPAYMENT' THEN
    required_prepayment := ROUND(COALESCE(NEW."penalty_base_amount", 0) * COALESCE(NEW."prepayment_ratio", 0), 2);
    SELECT COALESCE(SUM(payment."amount"), 0) INTO paid_prepayment
    FROM "factory_purchase_order_payments" payment
    WHERE payment."purchase_order_id" = NEW."id"
      AND payment."status" = 'CONFIRMED'
      AND payment."kind" = 'PREPAYMENT'
      AND payment."paid_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::DATE;
    IF paid_prepayment < required_prepayment THEN
      RAISE EXCEPTION 'factory purchase order prepayment is not sufficient for production';
    END IF;
  END IF;
  IF NEW."production_status" IS DISTINCT FROM OLD."production_status"
    AND NEW."production_status" = 'IN_PRODUCTION'
    AND OLD."production_status" IS DISTINCT FROM 'READY' THEN
    RAISE EXCEPTION 'factory purchase order production may only start from ready';
  END IF;
  IF OLD."production_started_at" IS NOT NULL AND (
    NEW."production_started_at" IS DISTINCT FROM OLD."production_started_at"
    OR NEW."production_started_by" IS DISTINCT FROM OLD."production_started_by"
  ) THEN
    RAISE EXCEPTION 'factory purchase order production start audit is immutable';
  END IF;
  IF NEW."production_status" = 'COMPLETED' AND OLD."production_status" IS DISTINCT FROM 'COMPLETED' THEN
    IF OLD."production_status" IS DISTINCT FROM 'IN_PRODUCTION'
      OR NEW."status" <> 'ACCEPTED'
      OR NEW."production_completed_at" IS NULL
      OR NEW."production_completed_at" < OLD."production_started_at"
      OR NEW."production_completed_at" > clock_timestamp()
      OR NEW."production_completion_recorded_at" IS NULL
      OR NEW."production_completion_recorded_at" < NEW."production_completed_at"
      OR NEW."production_completion_recorded_at" > clock_timestamp()
      OR NULLIF(BTRIM(NEW."production_completion_contact"), '') IS NULL THEN
      RAISE EXCEPTION 'factory purchase order completion state is invalid';
    END IF;

    IF NEW."production_completion_source" = 'SUPPLIER_PORTAL' THEN
      SELECT TRUE INTO completion_actor_valid
      FROM "users" completion_user
      JOIN "suppliers" completion_supplier ON completion_supplier."id" = completion_user."supplier_id"
      WHERE completion_user."id" = NEW."production_completed_by"
        AND completion_user."supplier_id" = NEW."supplier_id"
        AND LEFT(COALESCE(NULLIF(BTRIM(completion_user."name"), ''), '供应商账号'), 100) = NEW."production_completion_contact"
        AND completion_user."role" IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
        AND completion_user."is_active" = TRUE
        AND completion_user."approval_status" = 'APPROVED'
        AND completion_user."deleted_at" IS NULL
        AND completion_supplier."supplier_type" IN ('产品供应商', '工厂供应商', 'PRODUCT')
        AND completion_supplier."status" = '启用'
        AND completion_supplier."allow_factory_document_upload" = TRUE
        AND completion_supplier."deleted_at" IS NULL
        AND NEW."production_completion_channel" = 'PORTAL'
        AND NEW."production_completed_at" = NEW."production_completion_recorded_at"
      FOR SHARE OF completion_user, completion_supplier;
    ELSIF NEW."production_completion_source" = 'INTERNAL_OFFLINE' THEN
      SELECT TRUE INTO completion_actor_valid
      FROM "users" completion_user
      WHERE completion_user."id" = NEW."production_completed_by"
        AND completion_user."supplier_id" IS NULL
        AND completion_user."is_active" = TRUE
        AND completion_user."approval_status" = 'APPROVED'
        AND completion_user."deleted_at" IS NULL
        AND NEW."production_completion_channel" <> 'PORTAL'
      FOR SHARE OF completion_user;
    END IF;
    IF COALESCE(completion_actor_valid, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'factory purchase order completion source and recorder are invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The legacy actual-delivery columns remain as a materialized compatibility
-- cache.  They may contain zero per line and are proved against the sum of
-- APPROVED contributions in RELEASED containers at transaction end.
ALTER TABLE "factory_purchase_order_items"
  DROP CONSTRAINT "fpo_item_actual_delivered_quantity_check",
  ADD CONSTRAINT "fpo_item_actual_delivered_quantity_check" CHECK (
    "actual_delivered_quantity" IS NULL OR "actual_delivered_quantity" >= 0
  );

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_actual_delivered_quantity"() RETURNS trigger AS $$
BEGIN
  IF NEW."actual_delivered_quantity" IS NULL AND OLD."actual_delivered_quantity" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "factory_purchase_order_loading_result_items" AS legacy_item
      INNER JOIN "factory_purchase_order_loading_results" AS legacy_result
        ON legacy_result."id" = legacy_item."loading_result_id"
      INNER JOIN "sales_execution_container_loads" AS legacy_load
        ON legacy_load."id" = legacy_result."container_load_id"
      INNER JOIN "sales_executions" AS execution ON execution."id" = legacy_load."execution_id"
      WHERE legacy_item."purchase_order_item_id" = OLD."id"
        AND legacy_item."loaded_quantity" = OLD."actual_delivered_quantity"
        AND legacy_result."status" = 'APPROVED' AND legacy_result."legacy_backfill" = TRUE
        AND legacy_load."status" = 'RELEASED' AND legacy_load."legacy_backfill" = TRUE
        AND execution."shipping_started_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'actual delivered quantity cache cannot be cleared';
    END IF;
  END IF;
  IF OLD."actual_delivered_quantity" IS NOT NULL
    AND NEW."actual_delivered_quantity" IS NOT NULL
    AND NEW."actual_delivered_quantity" IS DISTINCT FROM OLD."actual_delivered_quantity" THEN
    RAISE EXCEPTION 'shipping materialized actual delivered quantity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "assert_factory_purchase_order_released_load_cache"(parent_id TEXT)
RETURNS void AS $$
DECLARE
  parent RECORD;
  released_count INTEGER;
  item_count INTEGER;
  actual_count INTEGER;
  mismatch_count INTEGER;
  latest_release RECORD;
BEGIN
  SELECT purchase_order."actual_delivery_date", purchase_order."actual_delivery_recorded_at",
         purchase_order."actual_delivery_recorded_by", execution."shipping_started_at",
         execution."shipping_started_by"
  INTO parent FROM "factory_purchase_orders" AS purchase_order
  INNER JOIN "sales_executions" AS execution ON execution."id" = purchase_order."execution_id"
  WHERE purchase_order."id" = parent_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(DISTINCT load."id") INTO released_count
  FROM "sales_execution_container_loads" AS load
  INNER JOIN "container_load_allocations" AS allocation ON allocation."container_load_id" = load."id"
  WHERE allocation."purchase_order_id" = parent_id AND load."status" = 'RELEASED';

  SELECT COUNT(*), COUNT(item."actual_delivered_quantity") INTO item_count, actual_count
  FROM "factory_purchase_order_items" AS item WHERE item."purchase_order_id" = parent_id;

  -- RELEASE and approval never materialize legacy actual-delivery columns.
  -- Before the execution enters shipping every cache column must remain empty.
  IF parent."shipping_started_at" IS NULL THEN
    IF parent."actual_delivery_date" IS NOT NULL OR actual_count <> 0 THEN
      RAISE EXCEPTION 'actual delivery cache may only be written by the shipping handoff';
    END IF;
    RETURN;
  END IF;

  IF released_count = 0 THEN
    RAISE EXCEPTION 'shipping handoff requires released container contributions';
  END IF;

  SELECT load."loading_date", load."released_at", load."released_by"
  INTO latest_release
  FROM "sales_execution_container_loads" AS load
  INNER JOIN "container_load_allocations" AS allocation ON allocation."container_load_id" = load."id"
  WHERE allocation."purchase_order_id" = parent_id AND load."status" = 'RELEASED'
  ORDER BY load."loading_date" DESC, load."released_at" DESC, load."id" DESC
  LIMIT 1;

  IF item_count = 0 OR actual_count <> item_count
    OR parent."actual_delivery_date" IS DISTINCT FROM latest_release."loading_date"
    OR parent."actual_delivery_recorded_at" IS DISTINCT FROM parent."shipping_started_at"
    OR parent."actual_delivery_recorded_by" IS DISTINCT FROM parent."shipping_started_by" THEN
    RAISE EXCEPTION 'actual delivery cache must use the latest released loading date and shipping actor';
  END IF;

  SELECT COUNT(*) INTO mismatch_count
  FROM "factory_purchase_order_items" AS item
  LEFT JOIN (
    SELECT result_item."purchase_order_item_id", SUM(result_item."loaded_quantity") AS released_quantity
    FROM "sales_execution_container_loads" AS load
    INNER JOIN "factory_purchase_order_loading_results" AS result
      ON result."container_load_id" = load."id" AND result."status" = 'APPROVED'
    INNER JOIN "factory_purchase_order_loading_result_items" AS result_item
      ON result_item."loading_result_id" = result."id"
    WHERE result."purchase_order_id" = parent_id AND load."status" = 'RELEASED'
    GROUP BY result_item."purchase_order_item_id"
  ) AS released ON released."purchase_order_item_id" = item."id"
  WHERE item."purchase_order_id" = parent_id
    AND item."actual_delivered_quantity" IS DISTINCT FROM COALESCE(released.released_quantity, 0);
  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'actual delivered quantities must equal cumulative approved contributions from released containers';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_actual_delivery_quantities"() RETURNS trigger AS $$
DECLARE
  parent_id TEXT;
BEGIN
  parent_id := CASE
    WHEN TG_TABLE_NAME = 'factory_purchase_orders' THEN TO_JSONB(NEW) ->> 'id'
    ELSE TO_JSONB(NEW) ->> 'purchase_order_id'
  END;
  PERFORM "assert_factory_purchase_order_released_load_cache"(parent_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Rebind the pre-existing compatibility-cache constraint triggers explicitly
-- so direct SQL cannot populate either the parent date or an item quantity
-- outside the shipping handoff transaction.
DROP TRIGGER IF EXISTS "factory_purchase_order_actual_delivery_quantity_parent_guard"
  ON "factory_purchase_orders";
CREATE CONSTRAINT TRIGGER "factory_purchase_order_actual_delivery_quantity_parent_guard"
AFTER UPDATE OF "actual_delivery_date", "actual_delivery_recorded_at", "actual_delivery_recorded_by"
ON "factory_purchase_orders"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_actual_delivery_quantities"();

DROP TRIGGER IF EXISTS "factory_purchase_order_actual_delivery_quantity_item_guard"
  ON "factory_purchase_order_items";
CREATE CONSTRAINT TRIGGER "factory_purchase_order_actual_delivery_quantity_item_guard"
AFTER UPDATE OF "actual_delivered_quantity" ON "factory_purchase_order_items"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_actual_delivery_quantities"();

-- Forward-replace the existing shipping anchor guard so a rejected purchase
-- order that has been superseded by a replacement is not treated as active.
-- Keep the original actor, state, locking, completion and quantity checks.
CREATE OR REPLACE FUNCTION "protect_sales_execution_shipping_anchor"() RETURNS trigger AS $$
DECLARE
  active_purchase_order_count INTEGER;
  invalid_purchase_order_count INTEGER;
  missing_actual_quantity_count INTEGER;
  short_execution_item_count INTEGER;
  unreleased_active_container_count INTEGER;
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
      AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
    ORDER BY purchase_order."id"
    FOR UPDATE;

    PERFORM item."id"
    FROM "factory_purchase_order_items" item
    INNER JOIN "factory_purchase_orders" purchase_order
      ON purchase_order."id" = item."purchase_order_id"
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
    ORDER BY item."id"
    FOR UPDATE OF item;

    SELECT COUNT(*)
    INTO unreleased_active_container_count
    FROM "sales_execution_container_loads" load
    WHERE load."execution_id" = NEW."id"
      AND load."status" NOT IN ('RELEASED', 'VOIDED')
      AND EXISTS (
        SELECT 1
        FROM "container_load_allocations" allocation
        INNER JOIN "factory_purchase_orders" purchase_order
          ON purchase_order."id" = allocation."purchase_order_id"
        WHERE allocation."container_load_id" = load."id"
          AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
      );
    IF unreleased_active_container_count <> 0 THEN
      RAISE EXCEPTION 'shipping requires every non-void container with active purchase-order allocations to be released';
    END IF;

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
      AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED');
    IF active_purchase_order_count = 0 OR invalid_purchase_order_count <> 0 THEN
      RAISE EXCEPTION 'shipping requires every active factory purchase order to be accepted, completed and delivered';
    END IF;

    SELECT COUNT(*)
    INTO missing_actual_quantity_count
    FROM "factory_purchase_order_items" item
    INNER JOIN "factory_purchase_orders" purchase_order
      ON purchase_order."id" = item."purchase_order_id"
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
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
        AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
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

CREATE OR REPLACE FUNCTION "validate_sales_execution_shipping_load_materialization"() RETURNS trigger AS $$
DECLARE
  parent_id TEXT;
BEGIN
  IF NEW."shipping_started_at" IS NOT NULL THEN
    FOR parent_id IN
      SELECT purchase_order."id" FROM "factory_purchase_orders" AS purchase_order
      WHERE purchase_order."execution_id" = NEW."id"
        AND purchase_order."status" NOT IN ('REJECTED', 'VOIDED')
    LOOP
      PERFORM "assert_factory_purchase_order_released_load_cache"(parent_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "sales_execution_shipping_load_materialization_guard"
AFTER UPDATE OF "shipping_started_at", "shipping_started_by" ON "sales_executions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_sales_execution_shipping_load_materialization"();

-- Existing unshipped actual-delivery cache rows would carry their historical
-- recorder into the future shipping transaction.  First prove that every such
-- value is preserved exactly in a RELEASED legacy container/result snapshot;
-- only then clear the compatibility cache.  Already-shipped executions remain
-- byte-for-byte unchanged.
DO $$
DECLARE
  invalid_legacy_purchase_order_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_legacy_purchase_order_count
  FROM "factory_purchase_orders" AS purchase_order
  INNER JOIN "sales_executions" AS execution ON execution."id" = purchase_order."execution_id"
  WHERE purchase_order."actual_delivery_date" IS NOT NULL
    AND execution."shipping_started_at" IS NULL
    AND (
      NOT EXISTS (
        SELECT 1
        FROM "sales_execution_container_loads" AS legacy_load
        INNER JOIN "container_load_allocations" AS allocation
          ON allocation."container_load_id" = legacy_load."id"
        INNER JOIN "factory_purchase_order_loading_results" AS legacy_result
          ON legacy_result."container_load_id" = legacy_load."id"
          AND legacy_result."purchase_order_id" = purchase_order."id"
        WHERE allocation."purchase_order_id" = purchase_order."id"
          AND legacy_load."status" = 'RELEASED' AND legacy_load."legacy_backfill" = TRUE
          AND legacy_load."loading_date" = purchase_order."actual_delivery_date"
          AND legacy_result."status" = 'APPROVED' AND legacy_result."legacy_backfill" = TRUE
      )
      OR EXISTS (
        SELECT 1
        FROM "factory_purchase_order_items" AS item
        LEFT JOIN "factory_purchase_order_loading_result_items" AS legacy_item
          ON legacy_item."purchase_order_item_id" = item."id"
          AND legacy_item."purchase_order_id" = item."purchase_order_id"
        LEFT JOIN "factory_purchase_order_loading_results" AS legacy_result
          ON legacy_result."id" = legacy_item."loading_result_id"
          AND legacy_result."legacy_backfill" = TRUE
          AND legacy_result."status" = 'APPROVED'
        WHERE item."purchase_order_id" = purchase_order."id"
          AND (item."actual_delivered_quantity" IS NULL
            OR legacy_item."id" IS NULL
            OR legacy_item."loaded_quantity" <> item."actual_delivered_quantity")
      )
    );
  IF invalid_legacy_purchase_order_count <> 0 THEN
    RAISE EXCEPTION 'legacy container backfill did not preserve every unshipped actual-delivery fact';
  END IF;
END;
$$;

UPDATE "factory_purchase_order_items" AS item
SET "actual_delivered_quantity" = NULL
FROM "factory_purchase_orders" AS purchase_order, "sales_executions" AS execution
WHERE item."purchase_order_id" = purchase_order."id"
  AND purchase_order."execution_id" = execution."id"
  AND purchase_order."actual_delivery_date" IS NOT NULL
  AND execution."shipping_started_at" IS NULL;

UPDATE "factory_purchase_orders" AS purchase_order
SET "actual_delivery_date" = NULL,
    "actual_delivery_recorded_at" = NULL,
    "actual_delivery_recorded_by" = NULL
FROM "sales_executions" AS execution
WHERE purchase_order."execution_id" = execution."id"
  AND purchase_order."actual_delivery_date" IS NOT NULL
  AND execution."shipping_started_at" IS NULL;

COMMIT;
