BEGIN;

-- Supplier acknowledgements are business facts that may be recorded either by
-- the supplier portal or by an internal operator after an offline reply. Keep
-- the original immutable history and add explicit source attribution.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

LOCK TABLE "factory_purchase_orders",
           "factory_purchase_order_supplier_responses",
           "factory_purchase_order_supplier_prices"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TYPE "FactoryConfirmationSource" AS ENUM (
  'SUPPLIER_PORTAL',
  'INTERNAL_OFFLINE'
);

CREATE TYPE "FactoryConfirmationChannel" AS ENUM (
  'PORTAL',
  'WECHAT',
  'PHONE',
  'EMAIL',
  'PAPER',
  'OTHER'
);

ALTER TABLE "factory_purchase_order_supplier_responses"
  ADD COLUMN "source" "FactoryConfirmationSource",
  ADD COLUMN "channel" "FactoryConfirmationChannel",
  ADD COLUMN "supplier_contact" TEXT,
  ADD COLUMN "supplier_responded_at" TIMESTAMP(3),
  ADD COLUMN "evidence_note" TEXT;

-- Only new attribution columns are being populated. Existing deferred workflow
-- triggers validate the historic response against today's PO state, so suspend
-- user triggers under the table lock for this narrow backfill.
ALTER TABLE "factory_purchase_order_supplier_responses" DISABLE TRIGGER USER;

UPDATE "factory_purchase_order_supplier_responses" response
SET "source" = 'SUPPLIER_PORTAL',
    "channel" = 'PORTAL',
    "supplier_contact" = LEFT(COALESCE(NULLIF(BTRIM(actor."name"), ''), '供应商账号'), 100),
    "supplier_responded_at" = response."responded_at"
FROM "users" actor
WHERE actor."id" = response."responded_by";

ALTER TABLE "factory_purchase_order_supplier_responses" ENABLE TRIGGER USER;

ALTER TABLE "factory_purchase_order_supplier_responses"
  ALTER COLUMN "source" SET NOT NULL,
  ALTER COLUMN "source" SET DEFAULT 'SUPPLIER_PORTAL',
  ALTER COLUMN "channel" SET NOT NULL,
  ALTER COLUMN "channel" SET DEFAULT 'PORTAL',
  ALTER COLUMN "supplier_contact" SET NOT NULL,
  ALTER COLUMN "supplier_responded_at" SET NOT NULL,
  ADD CONSTRAINT "factory_purchase_order_response_attribution_check" CHECK (
    NULLIF(BTRIM("supplier_contact"), '') IS NOT NULL
    AND CHAR_LENGTH("supplier_contact") <= 100
    AND "supplier_responded_at" <= "responded_at"
    AND ("evidence_note" IS NULL OR CHAR_LENGTH("evidence_note") <= 2000)
    AND (
      ("source" = 'SUPPLIER_PORTAL' AND "channel" = 'PORTAL')
      OR
      ("source" = 'INTERNAL_OFFLINE' AND "channel" <> 'PORTAL')
    )
  );

CREATE INDEX "fpo_supplier_response_source_time_idx"
  ON "factory_purchase_order_supplier_responses"("source", "supplier_responded_at");

ALTER TABLE "factory_purchase_orders"
  ADD COLUMN "production_completion_source" "FactoryConfirmationSource",
  ADD COLUMN "production_completion_channel" "FactoryConfirmationChannel",
  ADD COLUMN "production_completion_contact" TEXT,
  ADD COLUMN "production_completion_recorded_at" TIMESTAMP(3),
  ADD COLUMN "production_completion_remark" TEXT,
  ADD COLUMN "production_completion_evidence_note" TEXT;

ALTER TABLE "factory_purchase_orders" DISABLE TRIGGER USER;

UPDATE "factory_purchase_orders" purchase_order
SET "production_completion_source" = CASE
      WHEN actor."supplier_id" = purchase_order."supplier_id"
        THEN 'SUPPLIER_PORTAL'::"FactoryConfirmationSource"
      ELSE 'INTERNAL_OFFLINE'::"FactoryConfirmationSource"
    END,
    "production_completion_channel" = CASE
      WHEN actor."supplier_id" = purchase_order."supplier_id"
        THEN 'PORTAL'::"FactoryConfirmationChannel"
      ELSE 'OTHER'::"FactoryConfirmationChannel"
    END,
    "production_completion_contact" = LEFT(COALESCE(NULLIF(BTRIM(actor."name"), ''), '历史确认人'), 100),
    "production_completion_recorded_at" = purchase_order."production_completed_at"
FROM "users" actor
WHERE purchase_order."production_status" = 'COMPLETED'
  AND actor."id" = purchase_order."production_completed_by";

ALTER TABLE "factory_purchase_orders" ENABLE TRIGGER USER;

ALTER TABLE "factory_purchase_orders"
  ADD CONSTRAINT "factory_purchase_order_completion_attribution_check" CHECK (
    (
      "production_status" <> 'COMPLETED'
      AND "production_completed_at" IS NULL
      AND "production_completed_by" IS NULL
      AND "production_completion_source" IS NULL
      AND "production_completion_channel" IS NULL
      AND "production_completion_contact" IS NULL
      AND "production_completion_recorded_at" IS NULL
      AND "production_completion_remark" IS NULL
      AND "production_completion_evidence_note" IS NULL
    )
    OR
    (
      "production_status" = 'COMPLETED'
      AND "production_completed_at" IS NOT NULL
      AND "production_completed_by" IS NOT NULL
      AND "production_completion_source" IS NOT NULL
      AND "production_completion_channel" IS NOT NULL
      AND NULLIF(BTRIM("production_completion_contact"), '') IS NOT NULL
      AND CHAR_LENGTH("production_completion_contact") <= 100
      AND "production_completion_recorded_at" IS NOT NULL
      AND "production_completed_at" <= "production_completion_recorded_at"
      AND ("production_completion_remark" IS NULL OR CHAR_LENGTH("production_completion_remark") <= 2000)
      AND ("production_completion_evidence_note" IS NULL OR CHAR_LENGTH("production_completion_evidence_note") <= 2000)
      AND (
        ("production_completion_source" = 'SUPPLIER_PORTAL' AND "production_completion_channel" = 'PORTAL')
        OR
        ("production_completion_source" = 'INTERNAL_OFFLINE' AND "production_completion_channel" <> 'PORTAL')
      )
    )
  );

CREATE INDEX "fpo_completion_source_time_idx"
  ON "factory_purchase_orders"("production_completion_source", "production_completed_at");

-- Extend the existing immutable response history to include attribution. The
-- optional evidence note is immutable too; its absence never blocks a state.
CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_supplier_response"() RETURNS trigger AS $$
DECLARE
  parent RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier response history is immutable';
  END IF;
  IF NEW."purchase_order_id" IS DISTINCT FROM OLD."purchase_order_id"
    OR NEW."response_sequence" IS DISTINCT FROM OLD."response_sequence"
    OR NEW."action" IS DISTINCT FROM OLD."action"
    OR NEW."delivery_date" IS DISTINCT FROM OLD."delivery_date"
    OR NEW."remark" IS DISTINCT FROM OLD."remark"
    OR NEW."source" IS DISTINCT FROM OLD."source"
    OR NEW."channel" IS DISTINCT FROM OLD."channel"
    OR NEW."supplier_contact" IS DISTINCT FROM OLD."supplier_contact"
    OR NEW."supplier_responded_at" IS DISTINCT FROM OLD."supplier_responded_at"
    OR NEW."evidence_note" IS DISTINCT FROM OLD."evidence_note"
    OR NEW."responded_by" IS DISTINCT FROM OLD."responded_by"
    OR NEW."responded_at" IS DISTINCT FROM OLD."responded_at" THEN
    RAISE EXCEPTION 'supplier response history core fields are immutable';
  END IF;
  IF OLD."internal_decision" IS NOT NULL THEN
    IF NEW."internal_decision" IS DISTINCT FROM OLD."internal_decision"
      OR NEW."internal_decision_remark" IS DISTINCT FROM OLD."internal_decision_remark"
      OR NEW."internal_decided_at" IS DISTINCT FROM OLD."internal_decided_at"
      OR NEW."internal_decided_by" IS DISTINCT FROM OLD."internal_decided_by" THEN
      RAISE EXCEPTION 'supplier delivery decision is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."internal_decision" IS NULL THEN
    IF NEW."internal_decision_remark" IS NOT NULL
      OR NEW."internal_decided_at" IS NOT NULL
      OR NEW."internal_decided_by" IS NOT NULL THEN
      RAISE EXCEPTION 'supplier delivery decision audit is incomplete';
    END IF;
    RETURN NEW;
  END IF;

  SELECT purchase_order."status", purchase_order."production_status",
         purchase_order."actual_delivery_date", purchase_order."supplier_response_sequence",
         execution."shipping_started_at",
         EXISTS (
           SELECT 1 FROM "users" actor
           WHERE actor."id" = NEW."internal_decided_by"
             AND actor."supplier_id" IS NULL
             AND actor."is_active" = TRUE
             AND actor."approval_status" = 'APPROVED'
             AND actor."deleted_at" IS NULL
         ) AS actor_valid
  INTO parent
  FROM "factory_purchase_orders" purchase_order
  JOIN "sales_executions" execution ON execution."id" = purchase_order."execution_id"
  WHERE purchase_order."id" = NEW."purchase_order_id"
  FOR UPDATE OF purchase_order;

  IF NOT FOUND
    OR NEW."action" <> 'DELIVERY_PROPOSED'
    OR parent."status" <> 'DELIVERY_PROPOSED'
    OR NEW."response_sequence" <> parent."supplier_response_sequence"
    OR NEW."internal_decision" NOT IN ('ACCEPTED', 'REJECTED')
    OR NEW."internal_decided_at" IS NULL
    OR NEW."internal_decided_by" IS NULL
    OR NEW."internal_decided_at" < OLD."responded_at"
    OR parent.actor_valid IS NOT TRUE
    OR (
      NEW."internal_decision" = 'REJECTED'
      AND NULLIF(BTRIM(NEW."internal_decision_remark"), '') IS NULL
    ) THEN
    RAISE EXCEPTION 'supplier delivery decision requires the latest proposal and a complete internal audit';
  END IF;
  IF parent."production_status" = 'COMPLETED'
    OR parent."actual_delivery_date" IS NOT NULL
    OR parent."shipping_started_at" IS NOT NULL THEN
    RAISE EXCEPTION 'completed or delivered factory purchase order delivery is frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One actor guard accepts either a genuine portal operator or an active
-- internal recorder. Source and channel must agree with the actor identity.
CREATE OR REPLACE FUNCTION "validate_supplier_purchase_order_response_actor"() RETURNS trigger AS $$
DECLARE
  parent RECORD;
BEGIN
  SELECT purchase_order."production_status", purchase_order."status",
         purchase_order."actual_delivery_date", purchase_order."dispatched_at",
         purchase_order."supplier_id", execution."shipping_started_at",
         actor."supplier_id" AS actor_supplier_id, actor."role" AS actor_role,
         actor."name" AS actor_name, actor."is_active" AS actor_active,
         actor."approval_status" AS actor_approval_status,
         actor."deleted_at" AS actor_deleted_at,
         supplier."status" AS supplier_status,
         supplier."supplier_type" AS supplier_type,
         supplier."allow_factory_document_upload" AS supplier_portal_enabled,
         supplier."deleted_at" AS supplier_deleted_at
  INTO parent
  FROM "factory_purchase_orders" purchase_order
  JOIN "sales_executions" execution ON execution."id" = purchase_order."execution_id"
  JOIN "users" actor ON actor."id" = NEW."responded_by"
  LEFT JOIN "suppliers" supplier ON supplier."id" = purchase_order."supplier_id"
  WHERE purchase_order."id" = NEW."purchase_order_id"
  FOR UPDATE OF purchase_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier response requires a valid active recorder';
  END IF;

  -- Keep the previous portal release write-compatible during a rolling deploy.
  -- Old inserts receive the new attribution columns in this BEFORE INSERT guard.
  IF NEW."source" = 'SUPPLIER_PORTAL' THEN
    NEW."channel" := 'PORTAL';
    NEW."supplier_contact" := COALESCE(
      NULLIF(BTRIM(NEW."supplier_contact"), ''),
      LEFT(COALESCE(NULLIF(BTRIM(parent.actor_name), ''), '供应商账号'), 100)
    );
    NEW."supplier_responded_at" := COALESCE(NEW."supplier_responded_at", NEW."responded_at");
  END IF;

  IF parent.actor_active IS NOT TRUE
    OR parent.actor_approval_status <> 'APPROVED'
    OR parent.actor_deleted_at IS NOT NULL
    OR NEW."responded_at" > CURRENT_TIMESTAMP
    OR NULLIF(BTRIM(NEW."supplier_contact"), '') IS NULL THEN
    RAISE EXCEPTION 'supplier response requires a valid active recorder';
  END IF;

  IF NEW."source" = 'SUPPLIER_PORTAL' THEN
    IF NEW."channel" <> 'PORTAL'
      OR NEW."supplier_responded_at" IS DISTINCT FROM NEW."responded_at"
      OR NEW."supplier_contact" IS DISTINCT FROM LEFT(COALESCE(NULLIF(BTRIM(parent.actor_name), ''), '供应商账号'), 100)
      OR parent.actor_supplier_id IS DISTINCT FROM parent.supplier_id
      OR parent.actor_role NOT IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
      OR parent.supplier_status <> '启用'
      OR parent.supplier_type NOT IN ('产品供应商', '工厂供应商', 'PRODUCT')
      OR parent.supplier_portal_enabled IS NOT TRUE
      OR parent.supplier_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'portal response requires an active approved operator for the purchase order supplier';
    END IF;
  ELSIF NEW."source" = 'INTERNAL_OFFLINE' THEN
    IF NEW."channel" = 'PORTAL'
      OR parent.actor_supplier_id IS NOT NULL
      OR NEW."supplier_responded_at" < parent."dispatched_at"
      OR NEW."supplier_responded_at" > NEW."responded_at" THEN
      RAISE EXCEPTION 'offline response requires an active internal recorder and valid supplier reply time';
    END IF;
  ELSE
    RAISE EXCEPTION 'supplier response source is invalid';
  END IF;

  IF parent."status" NOT IN ('DISPATCHED', 'ACCEPTED') THEN
    RAISE EXCEPTION 'supplier response requires a dispatched order without a pending proposal';
  END IF;
  IF parent."production_status" = 'COMPLETED'
    OR parent."actual_delivery_date" IS NOT NULL
    OR parent."shipping_started_at" IS NOT NULL THEN
    RAISE EXCEPTION 'completed or delivered factory purchase order delivery is frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A supplier may confirm a different unit price once, on the first non-rejected
-- response. The immutable supplier-price row then becomes the effective price;
-- later commercial differences must use the adjustment ledger.
CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_supplier_price"() RETURNS trigger AS $$
DECLARE
  parent_status "FactoryPurchaseOrderStatus";
  parent_response_sequence INTEGER;
  allocated_quantity DECIMAL(18,4);
  response_sequence INTEGER;
  response_actor_id TEXT;
  response_time TIMESTAMP(3);
BEGIN
  SELECT purchase_order."status", purchase_order."supplier_response_sequence",
         item."allocated_quantity",
         response."response_sequence", response."responded_by", response."responded_at"
  INTO parent_status, parent_response_sequence, allocated_quantity,
       response_sequence, response_actor_id, response_time
  FROM "factory_purchase_order_items" item
  JOIN "factory_purchase_orders" purchase_order
    ON purchase_order."id" = item."purchase_order_id"
  JOIN "factory_purchase_order_supplier_responses" response
    ON response."id" = NEW."supplier_response_id"
   AND response."purchase_order_id" = NEW."purchase_order_id"
   AND response."action" <> 'REJECTED'
  WHERE item."id" = NEW."purchase_order_item_id"
    AND item."purchase_order_id" = NEW."purchase_order_id"
  FOR KEY SHARE OF purchase_order, item, response;

  IF NOT FOUND
    OR parent_status NOT IN ('DISPATCHED', 'ACCEPTED', 'DELIVERY_PROPOSED')
    OR response_sequence <> parent_response_sequence + 1
    OR NEW."confirmed_by" IS DISTINCT FROM response_actor_id
    OR NEW."confirmed_at" IS DISTINCT FROM response_time THEN
    RAISE EXCEPTION
      'supplier price must belong to the current supplier response and its real recorder';
  END IF;
  IF parent_response_sequence <> 0 THEN
    RAISE EXCEPTION 'dispatched purchase unit price may only be superseded by the first supplier response';
  END IF;
  IF NEW."amount" <> ROUND(allocated_quantity * NEW."unit_price", 2) THEN
    RAISE EXCEPTION 'supplier price amount must equal quantity multiplied by unit price';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Production completion uses the same attribution contract. The business
-- completion time may precede the internal recording time, but never the
-- production start. Evidence remains optional and is not checked here.
CREATE OR REPLACE FUNCTION "protect_supplier_factory_purchase_order_completion"() RETURNS trigger AS $$
DECLARE
  completion_actor_valid BOOLEAN := false;
  legacy_completion_actor RECORD;
  required_prepayment DECIMAL(18,2);
  paid_prepayment DECIMAL(18,2);
BEGIN
  -- Keep the previous portal release write-compatible during a rolling deploy.
  -- Old completion updates did not know about the new attribution columns.
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

  IF OLD."actual_delivery_date" IS NOT NULL AND (
    NEW."actual_delivery_date" IS DISTINCT FROM OLD."actual_delivery_date"
    OR NEW."actual_delivery_recorded_at" IS DISTINCT FROM OLD."actual_delivery_recorded_at"
    OR NEW."actual_delivery_recorded_by" IS DISTINCT FROM OLD."actual_delivery_recorded_by"
  ) THEN
    RAISE EXCEPTION 'actual factory delivery record is immutable';
  END IF;
  IF NEW."actual_delivery_date" IS NOT NULL AND OLD."actual_delivery_date" IS NULL THEN
    IF OLD."production_status" <> 'COMPLETED'
      OR NEW."actual_delivery_date" < (OLD."production_completed_at" AT TIME ZONE 'Asia/Shanghai')::DATE
      OR NEW."actual_delivery_date" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::DATE
      OR NEW."actual_delivery_recorded_at" IS NULL
      OR NEW."actual_delivery_recorded_by" IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "users" delivery_user
        WHERE delivery_user."id" = NEW."actual_delivery_recorded_by"
          AND delivery_user."is_active" = TRUE
          AND delivery_user."approval_status" = 'APPROVED'
          AND delivery_user."deleted_at" IS NULL
          AND delivery_user."role" NOT IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
      ) THEN
      RAISE EXCEPTION 'actual factory delivery record is invalid';
    END IF;
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
      OR NEW."production_completed_at" > CURRENT_TIMESTAMP
      OR NEW."production_completion_recorded_at" IS NULL
      OR NEW."production_completion_recorded_at" < NEW."production_completed_at"
      OR NEW."production_completion_recorded_at" > CURRENT_TIMESTAMP
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

COMMIT;
