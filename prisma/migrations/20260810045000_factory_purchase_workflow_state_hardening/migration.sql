BEGIN;

-- The repair and the replacement guards must see one stable workflow state.
LOCK TABLE "sales_executions",
           "factory_purchase_orders",
           "factory_purchase_order_supplier_responses"
  IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "users" IN SHARE MODE;

-- An internal decision belongs only to a delivery proposal. The audit tuple is
-- either wholly absent or complete, and a rejection always explains why.
ALTER TABLE "factory_purchase_order_supplier_responses"
  DROP CONSTRAINT "fpo_supplier_response_internal_decision_check",
  ADD CONSTRAINT "fpo_supplier_response_internal_decision_check" CHECK (
    (
      "internal_decision" IS NULL
      AND "internal_decision_remark" IS NULL
      AND "internal_decided_at" IS NULL
      AND "internal_decided_by" IS NULL
    ) OR (
      "action" = 'DELIVERY_PROPOSED'
      AND "internal_decision" IN ('ACCEPTED', 'REJECTED')
      AND "internal_decided_at" IS NOT NULL
      AND "internal_decided_by" IS NOT NULL
      AND (
        "internal_decision" = 'ACCEPTED'
        OR NULLIF(BTRIM("internal_decision_remark"), '') IS NOT NULL
      )
    )
  ) NOT VALID;

-- supplier_delivery_date is the effective confirmed date. The proposed date
-- remains in the immutable response row until an internal decision is made.
-- A first proposal therefore legitimately has no effective delivery date.
ALTER TABLE "factory_purchase_orders"
  DROP CONSTRAINT "factory_purchase_orders_response_state_check",
  ADD CONSTRAINT "factory_purchase_orders_response_state_check" CHECK (
    (
      "status" = 'DRAFT'
      AND "supplier_response_sequence" = 0
      AND "supplier_delivery_date" IS NULL
      AND "supplier_response_remark" IS NULL
      AND "responded_at" IS NULL
      AND "responded_by" IS NULL
    ) OR (
      "status" = 'DISPATCHED'
      AND "supplier_delivery_date" IS NULL
      AND "confirmed_supplier_delivery_date" IS NULL
      AND (
        (
          "supplier_response_sequence" = 0
          AND "supplier_response_remark" IS NULL
          AND "responded_at" IS NULL
          AND "responded_by" IS NULL
        ) OR (
          "supplier_response_sequence" > 0
          AND NULLIF(BTRIM("supplier_response_remark"), '') IS NOT NULL
          AND "responded_at" IS NOT NULL
          AND "responded_by" IS NOT NULL
        )
      )
    ) OR (
      "status" = 'ACCEPTED'
      AND "supplier_response_sequence" > 0
      AND "confirmed_supplier_delivery_date" IS NOT NULL
      AND "supplier_delivery_date" IS NOT DISTINCT FROM "confirmed_supplier_delivery_date"
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    ) OR (
      "status" = 'DELIVERY_PROPOSED'
      AND "supplier_response_sequence" > 0
      AND "supplier_delivery_date" IS NOT DISTINCT FROM "confirmed_supplier_delivery_date"
      AND NULLIF(BTRIM("supplier_response_remark"), '') IS NOT NULL
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    ) OR (
      "status" = 'REJECTED'
      AND "supplier_response_sequence" > 0
      AND NULLIF(BTRIM("supplier_response_remark"), '') IS NOT NULL
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    ) OR "status" = 'VOIDED'
  ) NOT VALID;

-- Legacy workflow evidence: before internal delivery decisions existed, an
-- internal user starting production was the durable act that accepted the
-- supplier's then-current date. Backfill only the most recent earlier proposal
-- whose date exactly equals the frozen initial promise and whose response
-- predates production start. Anything less certain remains unresolved and will
-- fail the frozen-proposal preflight below.
ALTER TABLE "factory_purchase_order_supplier_responses"
  DISABLE TRIGGER "factory_purchase_order_supplier_responses_immutability_guard";

WITH legacy_production_acceptance AS (
  SELECT DISTINCT ON (purchase_order."id")
    purchase_order."id" AS purchase_order_id,
    response."id" AS response_id,
    purchase_order."production_started_at" AS decided_at,
    purchase_order."production_started_by" AS decided_by
  FROM "factory_purchase_orders" purchase_order
  JOIN "users" production_actor
    ON production_actor."id" = purchase_order."production_started_by"
  JOIN "factory_purchase_order_supplier_responses" response
    ON response."purchase_order_id" = purchase_order."id"
  WHERE purchase_order."status" = 'DELIVERY_PROPOSED'
    AND purchase_order."production_status" IN ('IN_PRODUCTION', 'COMPLETED')
    AND purchase_order."production_started_at" IS NOT NULL
    AND purchase_order."production_started_by" IS NOT NULL
    AND purchase_order."initial_supplier_delivery_date" IS NOT NULL
    AND production_actor."role" IN ('管理员', '业务员')
    AND production_actor."supplier_id" IS NULL
    AND production_actor."is_active" = TRUE
    AND production_actor."approval_status" = 'APPROVED'
    AND production_actor."deleted_at" IS NULL
    AND response."response_sequence" < purchase_order."supplier_response_sequence"
    AND response."action" = 'DELIVERY_PROPOSED'
    AND response."delivery_date" IS NOT DISTINCT FROM purchase_order."initial_supplier_delivery_date"
    AND response."responded_at" <= purchase_order."production_started_at"
    AND response."internal_decision" IS NULL
    AND response."internal_decision_remark" IS NULL
    AND response."internal_decided_at" IS NULL
    AND response."internal_decided_by" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "factory_purchase_order_supplier_responses" confirmed_response
      WHERE confirmed_response."purchase_order_id" = purchase_order."id"
        AND confirmed_response."response_sequence" < purchase_order."supplier_response_sequence"
        AND confirmed_response."delivery_date" IS NOT NULL
        AND (
          confirmed_response."action" = 'ACCEPTED'
          OR (
            confirmed_response."action" = 'DELIVERY_PROPOSED'
            AND confirmed_response."internal_decision" = 'ACCEPTED'
          )
        )
    )
  ORDER BY purchase_order."id", response."response_sequence" DESC,
           response."responded_at" DESC, response."id" DESC
)
UPDATE "factory_purchase_order_supplier_responses" response
SET "internal_decision" = 'ACCEPTED',
    "internal_decision_remark" = '系统迁移：旧流程中内部开始生产视为接受该供应商交期',
    "internal_decided_at" = legacy.decided_at,
    "internal_decided_by" = legacy.decided_by
FROM legacy_production_acceptance legacy
WHERE response."id" = legacy.response_id;

ALTER TABLE "factory_purchase_order_supplier_responses"
  ENABLE TRIGGER "factory_purchase_order_supplier_responses_immutability_guard";

-- Capture each pending proposal together with the most recent *earlier*
-- genuinely confirmed response. The current unresolved proposal is never
-- allowed to masquerade as a confirmed delivery date.
CREATE TEMP TABLE "_factory_delivery_proposal_repair" ON COMMIT DROP AS
SELECT
  purchase_order."id" AS purchase_order_id,
  purchase_order."production_status" AS production_status,
  purchase_order."actual_delivery_date" AS actual_delivery_date,
  execution."shipping_started_at" AS shipping_started_at,
  purchase_order."supplier_response_sequence" AS supplier_response_sequence,
  latest_response."id" AS latest_response_id,
  latest_response."action" AS latest_action,
  latest_response."delivery_date" AS latest_delivery_date,
  latest_response."internal_decision" AS latest_internal_decision,
  latest_response."internal_decision_remark" AS latest_internal_decision_remark,
  latest_response."internal_decided_at" AS latest_internal_decided_at,
  latest_response."internal_decided_by" AS latest_internal_decided_by,
  prior_confirmation."delivery_date" AS prior_confirmed_delivery_date,
  (
    purchase_order."production_status" = 'COMPLETED'
    OR purchase_order."actual_delivery_date" IS NOT NULL
    OR execution."shipping_started_at" IS NOT NULL
  ) AS delivery_frozen,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "users" actor
      WHERE actor."id" = purchase_order."production_started_by"
        AND actor."supplier_id" IS NULL
        AND actor."is_active" = TRUE
        AND actor."approval_status" = 'APPROVED'
        AND actor."deleted_at" IS NULL
    ) THEN purchase_order."production_started_by"
    WHEN EXISTS (
      SELECT 1 FROM "users" actor
      WHERE actor."id" = purchase_order."dispatched_by"
        AND actor."supplier_id" IS NULL
        AND actor."is_active" = TRUE
        AND actor."approval_status" = 'APPROVED'
        AND actor."deleted_at" IS NULL
    ) THEN purchase_order."dispatched_by"
    ELSE NULL
  END AS repair_actor_id
FROM "factory_purchase_orders" purchase_order
JOIN "sales_executions" execution ON execution."id" = purchase_order."execution_id"
LEFT JOIN LATERAL (
  SELECT response.*
  FROM "factory_purchase_order_supplier_responses" response
  WHERE response."purchase_order_id" = purchase_order."id"
  ORDER BY response."response_sequence" DESC, response."responded_at" DESC, response."id" DESC
  LIMIT 1
) latest_response ON TRUE
LEFT JOIN LATERAL (
  SELECT response."delivery_date"
  FROM "factory_purchase_order_supplier_responses" response
  WHERE response."purchase_order_id" = purchase_order."id"
    AND response."response_sequence" < purchase_order."supplier_response_sequence"
    AND response."delivery_date" IS NOT NULL
    AND (
      response."action" = 'ACCEPTED'
      OR (
        response."action" = 'DELIVERY_PROPOSED'
        AND response."internal_decision" = 'ACCEPTED'
      )
    )
  ORDER BY response."response_sequence" DESC, response."responded_at" DESC, response."id" DESC
  LIMIT 1
) prior_confirmation ON TRUE
WHERE purchase_order."status" = 'DELIVERY_PROPOSED';

DO $$
DECLARE
  invalid_purchase_order_id TEXT;
BEGIN
  SELECT repair.purchase_order_id
  INTO invalid_purchase_order_id
  FROM "_factory_delivery_proposal_repair" repair
  WHERE repair.latest_response_id IS NULL
    OR repair.latest_action IS DISTINCT FROM 'DELIVERY_PROPOSED'
    OR repair.supplier_response_sequence IS DISTINCT FROM (
      SELECT response."response_sequence"
      FROM "factory_purchase_order_supplier_responses" response
      WHERE response."id" = repair.latest_response_id
    )
  ORDER BY repair.purchase_order_id
  LIMIT 1;
  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'delivery-proposed purchase order % has no matching latest proposal response', invalid_purchase_order_id;
  END IF;

  SELECT repair.purchase_order_id
  INTO invalid_purchase_order_id
  FROM "_factory_delivery_proposal_repair" repair
  LEFT JOIN "users" actor ON actor."id" = repair.latest_internal_decided_by
  WHERE repair.latest_internal_decision IS NOT NULL
    AND (
      repair.latest_internal_decision NOT IN ('ACCEPTED', 'REJECTED')
      OR repair.latest_internal_decided_at IS NULL
      OR repair.latest_internal_decided_by IS NULL
      OR actor."id" IS NULL
      OR actor."supplier_id" IS NOT NULL
      OR actor."is_active" IS NOT TRUE
      OR actor."approval_status" IS DISTINCT FROM 'APPROVED'
      OR actor."deleted_at" IS NOT NULL
      OR (
        repair.latest_internal_decision = 'REJECTED'
        AND NULLIF(BTRIM(repair.latest_internal_decision_remark), '') IS NULL
      )
    )
  ORDER BY repair.purchase_order_id
  LIMIT 1;
  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'delivery proposal % has an invalid existing internal decision audit', invalid_purchase_order_id;
  END IF;

  SELECT repair.purchase_order_id
  INTO invalid_purchase_order_id
  FROM "_factory_delivery_proposal_repair" repair
  WHERE repair.delivery_frozen
    AND repair.latest_internal_decision IS NULL
    AND repair.prior_confirmed_delivery_date IS NULL
  ORDER BY repair.purchase_order_id
  LIMIT 1;
  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'frozen delivery proposal % has no earlier genuinely confirmed delivery date', invalid_purchase_order_id;
  END IF;

  SELECT repair.purchase_order_id
  INTO invalid_purchase_order_id
  FROM "_factory_delivery_proposal_repair" repair
  WHERE repair.delivery_frozen
    AND repair.latest_internal_decision IS NULL
    AND repair.repair_actor_id IS NULL
  ORDER BY repair.purchase_order_id
  LIMIT 1;
  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'frozen delivery proposal % has no active approved internal repair actor', invalid_purchase_order_id;
  END IF;

  SELECT repair.purchase_order_id
  INTO invalid_purchase_order_id
  FROM "_factory_delivery_proposal_repair" repair
  WHERE repair.production_status IN ('IN_PRODUCTION', 'COMPLETED')
    AND CASE
      WHEN repair.latest_internal_decision = 'ACCEPTED' THEN repair.latest_delivery_date
      ELSE repair.prior_confirmed_delivery_date
    END IS NULL
  ORDER BY repair.purchase_order_id
  LIMIT 1;
  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'started purchase order % has no genuinely confirmed delivery anchor', invalid_purchase_order_id;
  END IF;
END;
$$;

-- Close only unresolved proposals that have crossed a delivery-freeze boundary.
-- The deterministic actor priority is production starter, then PO dispatcher.
UPDATE "factory_purchase_order_supplier_responses" response
SET "internal_decision" = 'REJECTED',
    "internal_decision_remark" = '系统迁移：采购单已完成生产或进入交付，自动关闭未决交期提议',
    "internal_decided_at" = CURRENT_TIMESTAMP,
    "internal_decided_by" = repair.repair_actor_id
FROM "_factory_delivery_proposal_repair" repair
WHERE response."id" = repair.latest_response_id
  AND repair.delivery_frozen
  AND repair.latest_internal_decision IS NULL;

-- The old guards encode the corrupted effective-date assumption. Disable only
-- those three guards while the locked, prevalidated rows are normalized.
ALTER TABLE "factory_purchase_orders"
  DISABLE TRIGGER "factory_purchase_orders_status_transition_guard";
ALTER TABLE "factory_purchase_orders"
  DISABLE TRIGGER "factory_purchase_orders_supplier_completion_guard";
ALTER TABLE "factory_purchase_orders"
  DISABLE TRIGGER "factory_purchase_orders_execution_anchor_guard";

UPDATE "factory_purchase_orders" purchase_order
SET "status" = CASE
      WHEN repair.latest_internal_decision = 'ACCEPTED' THEN 'ACCEPTED'::"FactoryPurchaseOrderStatus"
      WHEN repair.latest_internal_decision = 'REJECTED' OR (
        repair.delivery_frozen AND repair.latest_internal_decision IS NULL
      ) THEN CASE
        WHEN repair.prior_confirmed_delivery_date IS NULL THEN 'DISPATCHED'::"FactoryPurchaseOrderStatus"
        ELSE 'ACCEPTED'::"FactoryPurchaseOrderStatus"
      END
      ELSE 'DELIVERY_PROPOSED'::"FactoryPurchaseOrderStatus"
    END,
    "confirmed_supplier_delivery_date" = CASE
      WHEN repair.latest_internal_decision = 'ACCEPTED' THEN repair.latest_delivery_date
      ELSE repair.prior_confirmed_delivery_date
    END,
    "supplier_delivery_date" = CASE
      WHEN repair.latest_internal_decision = 'ACCEPTED' THEN repair.latest_delivery_date
      ELSE repair.prior_confirmed_delivery_date
    END,
    "initial_supplier_delivery_date" = CASE
      WHEN COALESCE(
        CASE WHEN repair.latest_internal_decision = 'ACCEPTED' THEN repair.latest_delivery_date END,
        repair.prior_confirmed_delivery_date
      ) IS NULL THEN NULL
      ELSE purchase_order."initial_supplier_delivery_date"
    END,
    "penalty_base_amount" = CASE
      WHEN COALESCE(
        CASE WHEN repair.latest_internal_decision = 'ACCEPTED' THEN repair.latest_delivery_date END,
        repair.prior_confirmed_delivery_date
      ) IS NULL THEN NULL
      ELSE purchase_order."penalty_base_amount"
    END,
    "production_status" = CASE
      WHEN COALESCE(
        CASE WHEN repair.latest_internal_decision = 'ACCEPTED' THEN repair.latest_delivery_date END,
        repair.prior_confirmed_delivery_date
      ) IS NULL THEN 'WAITING_SUPPLIER'::"FactoryPurchaseOrderProductionStatus"
      ELSE purchase_order."production_status"
    END,
    "revision" = purchase_order."revision" + 1,
    "updated_by" = CASE
      WHEN repair.latest_internal_decision IS NOT NULL THEN repair.latest_internal_decided_by
      WHEN repair.delivery_frozen THEN repair.repair_actor_id
      ELSE purchase_order."updated_by"
    END
FROM "_factory_delivery_proposal_repair" repair
WHERE purchase_order."id" = repair.purchase_order_id;

ALTER TABLE "factory_purchase_orders"
  ENABLE TRIGGER "factory_purchase_orders_execution_anchor_guard";
ALTER TABLE "factory_purchase_orders"
  ENABLE TRIGGER "factory_purchase_orders_supplier_completion_guard";
ALTER TABLE "factory_purchase_orders"
  ENABLE TRIGGER "factory_purchase_orders_status_transition_guard";

ALTER TABLE "factory_purchase_order_supplier_responses"
  VALIDATE CONSTRAINT "fpo_supplier_response_internal_decision_check";
ALTER TABLE "factory_purchase_orders"
  VALIDATE CONSTRAINT "factory_purchase_orders_response_state_check";

-- A replacement is a new draft inside a dispatched, not-yet-shipped execution.
-- It can point only to a fully voided original in the same execution.
CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_execution_parent"() RETURNS trigger AS $$
DECLARE
  parent_status "SalesExecutionStatus";
  parent_shipping_started_at TIMESTAMP(3);
  replacement_valid BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
    RAISE EXCEPTION 'factory purchase orders must start as drafts';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW."replacement_for_id" IS DISTINCT FROM OLD."replacement_for_id" THEN
    RAISE EXCEPTION 'purchase order replacement link must be supplied on insert and is immutable';
  END IF;

  SELECT execution."status", execution."shipping_started_at"
  INTO parent_status, parent_shipping_started_at
  FROM "sales_executions" execution
  WHERE execution."id" = NEW."execution_id"
  FOR KEY SHARE;

  IF NEW."replacement_for_id" IS NOT NULL THEN
    SELECT TRUE INTO replacement_valid
    FROM "factory_purchase_orders" original
    WHERE original."id" = NEW."replacement_for_id"
      AND original."execution_id" = NEW."execution_id"
      AND original."status" = 'VOIDED'
      AND original."voided_at" IS NOT NULL
      AND original."voided_by" IS NOT NULL
      AND NULLIF(BTRIM(original."void_reason"), '') IS NOT NULL
    FOR KEY SHARE;
  END IF;

  IF NEW."replacement_for_id" IS NULL THEN
    IF parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
      RAISE EXCEPTION 'factory purchase orders can only be created or moved inside draft sales executions';
    END IF;
  ELSIF parent_status IS DISTINCT FROM 'DISPATCHED'::"SalesExecutionStatus"
    OR parent_shipping_started_at IS NOT NULL
    OR COALESCE(replacement_valid, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'replacement purchase order requires one fully voided original in the same unshipped execution';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "factory_purchase_orders_execution_parent_guard" ON "factory_purchase_orders";
CREATE TRIGGER "factory_purchase_orders_execution_parent_guard"
  BEFORE INSERT OR UPDATE OF "execution_id", "replacement_for_id" ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_execution_parent"();

DO $$
DECLARE
  invalid_replacement_id TEXT;
BEGIN
  SELECT replacement."id"
  INTO invalid_replacement_id
  FROM "factory_purchase_orders" replacement
  LEFT JOIN "factory_purchase_orders" original ON original."id" = replacement."replacement_for_id"
  LEFT JOIN "sales_executions" execution ON execution."id" = replacement."execution_id"
  WHERE replacement."replacement_for_id" IS NOT NULL
    AND (
      original."id" IS NULL
      OR original."execution_id" IS DISTINCT FROM replacement."execution_id"
      OR original."status" IS DISTINCT FROM 'VOIDED'::"FactoryPurchaseOrderStatus"
      OR original."voided_at" IS NULL
      OR original."voided_by" IS NULL
      OR NULLIF(BTRIM(original."void_reason"), '') IS NULL
      OR execution."status" IS DISTINCT FROM 'DISPATCHED'::"SalesExecutionStatus"
      OR execution."shipping_started_at" IS NOT NULL
    )
  ORDER BY replacement."id"
  LIMIT 1;
  IF invalid_replacement_id IS NOT NULL THEN
    RAISE EXCEPTION 'existing replacement purchase order % has an invalid voided original', invalid_replacement_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_status_transition"() RETURNS trigger AS $$
DECLARE
  response_changed BOOLEAN;
  response_audit_changed BOOLEAN;
  latest_response RECORD;
BEGIN
  response_audit_changed :=
    NEW."supplier_response_sequence" IS DISTINCT FROM OLD."supplier_response_sequence"
    OR NEW."supplier_response_remark" IS DISTINCT FROM OLD."supplier_response_remark"
    OR NEW."responded_at" IS DISTINCT FROM OLD."responded_at"
    OR NEW."responded_by" IS DISTINCT FROM OLD."responded_by";
  response_changed := response_audit_changed
    OR NEW."supplier_delivery_date" IS DISTINCT FROM OLD."supplier_delivery_date";

  IF OLD."status" = 'DRAFT'
    AND NEW."status" NOT IN ('DRAFT', 'DISPATCHED', 'VOIDED') THEN
    RAISE EXCEPTION 'factory purchase order must be dispatched before supplier response';
  END IF;
  IF OLD."status" = 'DISPATCHED'
    AND NEW."status" NOT IN ('DISPATCHED', 'ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED', 'VOIDED') THEN
    RAISE EXCEPTION 'invalid dispatched factory purchase order transition';
  END IF;
  IF OLD."status" = 'REJECTED' THEN
    IF NEW."status" NOT IN ('REJECTED', 'VOIDED') THEN
      RAISE EXCEPTION 'rejected supplier response is terminal';
    END IF;
    IF NEW."status" = 'REJECTED' AND response_changed THEN
      RAISE EXCEPTION 'rejected supplier response is immutable';
    END IF;
  END IF;
  IF OLD."status" = 'ACCEPTED'
    AND NEW."status" NOT IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'VOIDED') THEN
    RAISE EXCEPTION 'accepted supplier response can only propose a later delivery change';
  END IF;
  IF OLD."status" = 'DELIVERY_PROPOSED'
    AND NEW."status" NOT IN ('DELIVERY_PROPOSED', 'ACCEPTED', 'DISPATCHED', 'VOIDED') THEN
    RAISE EXCEPTION 'delivery proposal requires an internal decision';
  END IF;
  IF OLD."status" = 'VOIDED' AND NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'voided factory purchase order cannot be restored';
  END IF;
  IF NEW."status" = 'VOIDED' THEN RETURN NEW; END IF;

  IF OLD."status" = 'DELIVERY_PROPOSED'
    AND NEW."status" IN ('ACCEPTED', 'DISPATCHED') THEN
    IF response_audit_changed THEN
      RAISE EXCEPTION 'internal delivery decision cannot rewrite supplier response audit fields';
    END IF;
    SELECT response."response_sequence", response."action", response."delivery_date",
           response."responded_at", response."internal_decision",
           response."internal_decision_remark", response."internal_decided_at",
           response."internal_decided_by", execution."shipping_started_at",
           EXISTS (
             SELECT 1 FROM "users" actor
             WHERE actor."id" = response."internal_decided_by"
               AND actor."supplier_id" IS NULL
               AND actor."is_active" = TRUE
               AND actor."approval_status" = 'APPROVED'
               AND actor."deleted_at" IS NULL
           ) AS actor_valid
    INTO latest_response
    FROM "factory_purchase_order_supplier_responses" response
    JOIN "sales_executions" execution ON execution."id" = NEW."execution_id"
    WHERE response."purchase_order_id" = NEW."id"
    ORDER BY response."response_sequence" DESC, response."responded_at" DESC, response."id" DESC
    LIMIT 1;

    IF NOT FOUND
      OR latest_response."response_sequence" IS DISTINCT FROM OLD."supplier_response_sequence"
      OR latest_response."action" IS DISTINCT FROM 'DELIVERY_PROPOSED'
      OR latest_response."internal_decision" NOT IN ('ACCEPTED', 'REJECTED')
      OR latest_response."internal_decided_at" IS NULL
      OR latest_response."internal_decided_by" IS NULL
      OR latest_response."internal_decided_at" < latest_response."responded_at"
      OR latest_response.actor_valid IS NOT TRUE
      OR (
        latest_response."internal_decision" = 'REJECTED'
        AND NULLIF(BTRIM(latest_response."internal_decision_remark"), '') IS NULL
      ) THEN
      RAISE EXCEPTION 'latest delivery proposal requires a complete decision by an active approved internal actor';
    END IF;
    IF OLD."production_status" = 'COMPLETED'
      OR OLD."actual_delivery_date" IS NOT NULL
      OR latest_response."shipping_started_at" IS NOT NULL THEN
      RAISE EXCEPTION 'completed or delivered factory purchase order delivery is frozen';
    END IF;

    IF latest_response."internal_decision" = 'ACCEPTED' THEN
      IF NEW."status" <> 'ACCEPTED'
        OR NEW."confirmed_supplier_delivery_date" IS DISTINCT FROM latest_response."delivery_date"
        OR NEW."supplier_delivery_date" IS DISTINCT FROM latest_response."delivery_date" THEN
        RAISE EXCEPTION 'accepted delivery proposal must become the effective confirmed delivery date';
      END IF;
      IF OLD."confirmed_supplier_delivery_date" IS NULL AND (
        NEW."initial_supplier_delivery_date" IS NULL
        OR NEW."penalty_base_amount" IS NULL
        OR NEW."production_status" NOT IN ('WAITING_PREPAYMENT', 'READY')
      ) THEN
        RAISE EXCEPTION 'first accepted delivery proposal must freeze production anchors';
      END IF;
    ELSIF OLD."confirmed_supplier_delivery_date" IS NULL THEN
      IF NEW."status" <> 'DISPATCHED'
        OR NEW."confirmed_supplier_delivery_date" IS NOT NULL
        OR NEW."supplier_delivery_date" IS NOT NULL
        OR NEW."production_status" <> 'WAITING_SUPPLIER' THEN
        RAISE EXCEPTION 'rejected first delivery proposal must restore the dispatched waiting state';
      END IF;
    ELSIF NEW."status" <> 'ACCEPTED'
      OR NEW."confirmed_supplier_delivery_date" IS DISTINCT FROM OLD."confirmed_supplier_delivery_date"
      OR NEW."supplier_delivery_date" IS DISTINCT FROM OLD."confirmed_supplier_delivery_date" THEN
      RAISE EXCEPTION 'rejected delivery proposal must restore the prior confirmed delivery date';
    END IF;
    RETURN NEW;
  END IF;

  IF response_changed AND NEW."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED') THEN
    IF NEW."supplier_response_sequence" <> OLD."supplier_response_sequence" + 1 THEN
      RAISE EXCEPTION 'supplier response sequence must advance exactly once';
    END IF;
    IF OLD."status" = 'DELIVERY_PROPOSED' THEN
      RAISE EXCEPTION 'the pending delivery proposal requires an internal decision first';
    END IF;
    IF OLD."status" = 'ACCEPTED' AND NEW."status" <> 'DELIVERY_PROPOSED' THEN
      RAISE EXCEPTION 'later supplier responses may only change delivery date';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "factory_purchase_order_supplier_responses" response
      WHERE response."purchase_order_id" = NEW."id"
        AND response."response_sequence" = NEW."supplier_response_sequence"
        AND response."action" = NEW."status"::TEXT
        AND (
          (NEW."status" = 'DELIVERY_PROPOSED' AND response."delivery_date" IS NOT NULL)
          OR (NEW."status" <> 'DELIVERY_PROPOSED' AND response."delivery_date" IS NOT DISTINCT FROM NEW."supplier_delivery_date")
        )
        AND response."remark" IS NOT DISTINCT FROM NEW."supplier_response_remark"
        AND response."responded_by" = NEW."responded_by"
        AND response."responded_at" = NEW."responded_at"
    ) THEN
      RAISE EXCEPTION 'supplier response history row is required';
    END IF;
    IF NEW."status" = 'ACCEPTED' AND (
      NEW."confirmed_supplier_delivery_date" IS DISTINCT FROM NEW."supplier_delivery_date"
      OR NEW."initial_supplier_delivery_date" IS NULL
      OR NEW."penalty_base_amount" IS NULL
      OR NEW."production_status" NOT IN ('WAITING_PREPAYMENT', 'READY')
    ) THEN
      RAISE EXCEPTION 'accepted supplier response must freeze delivery and production anchors';
    END IF;
    IF NEW."status" = 'DELIVERY_PROPOSED' AND (
      NEW."confirmed_supplier_delivery_date" IS DISTINCT FROM OLD."confirmed_supplier_delivery_date"
      OR NEW."supplier_delivery_date" IS DISTINCT FROM OLD."confirmed_supplier_delivery_date"
      OR NEW."initial_supplier_delivery_date" IS DISTINCT FROM OLD."initial_supplier_delivery_date"
      OR NEW."penalty_base_amount" IS DISTINCT FROM OLD."penalty_base_amount"
      OR NEW."production_status" IS DISTINCT FROM OLD."production_status"
    ) THEN
      RAISE EXCEPTION 'pending delivery proposal cannot change effective delivery or production anchors';
    END IF;
  ELSIF OLD."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED') AND response_changed THEN
    RAISE EXCEPTION 'supplier response fields require a new delivery proposal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

CREATE OR REPLACE FUNCTION "validate_supplier_purchase_order_response_actor"() RETURNS trigger AS $$
DECLARE
  parent RECORD;
  response_actor_valid BOOLEAN := false;
BEGIN
  SELECT purchase_order."production_status", purchase_order."status",
         purchase_order."actual_delivery_date", execution."shipping_started_at"
  INTO parent
  FROM "factory_purchase_orders" purchase_order
  JOIN "sales_executions" execution ON execution."id" = purchase_order."execution_id"
  JOIN "users" response_user ON response_user."id" = NEW."responded_by"
  JOIN "suppliers" response_supplier ON response_supplier."id" = response_user."supplier_id"
  WHERE purchase_order."id" = NEW."purchase_order_id"
    AND response_user."supplier_id" = purchase_order."supplier_id"
    AND response_user."role" IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
    AND response_user."is_active" = TRUE
    AND response_user."approval_status" = 'APPROVED'
    AND response_user."deleted_at" IS NULL
    AND response_supplier."status" = '启用'
    AND response_supplier."supplier_type" IN ('产品供应商', '工厂供应商', 'PRODUCT')
    AND response_supplier."allow_factory_document_upload" = TRUE
    AND response_supplier."deleted_at" IS NULL
  FOR UPDATE OF purchase_order;
  response_actor_valid := FOUND;

  IF response_actor_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'supplier response requires an active approved operator for the purchase order supplier';
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

-- The final decision must be committed together with the corresponding PO
-- state transition; updating only the response row is not a valid closure.
CREATE FUNCTION "validate_factory_purchase_order_delivery_decision_consistency"() RETURNS trigger AS $$
DECLARE
  purchase_order RECORD;
BEGIN
  SELECT "status", "supplier_response_sequence", "supplier_delivery_date",
         "confirmed_supplier_delivery_date"
  INTO purchase_order
  FROM "factory_purchase_orders"
  WHERE "id" = NEW."purchase_order_id";
  IF NOT FOUND
    OR purchase_order."supplier_response_sequence" <> NEW."response_sequence"
    OR (
      NEW."internal_decision" = 'ACCEPTED'
      AND (
        purchase_order."status" <> 'ACCEPTED'
        OR purchase_order."confirmed_supplier_delivery_date" IS DISTINCT FROM NEW."delivery_date"
        OR purchase_order."supplier_delivery_date" IS DISTINCT FROM NEW."delivery_date"
      )
    )
    OR (
      NEW."internal_decision" = 'REJECTED'
      AND (
        purchase_order."status" NOT IN ('ACCEPTED', 'DISPATCHED')
        OR purchase_order."supplier_delivery_date" IS DISTINCT FROM purchase_order."confirmed_supplier_delivery_date"
        OR (purchase_order."status" = 'DISPATCHED' AND purchase_order."confirmed_supplier_delivery_date" IS NOT NULL)
        OR (purchase_order."status" = 'ACCEPTED' AND purchase_order."confirmed_supplier_delivery_date" IS NULL)
      )
    ) THEN
    RAISE EXCEPTION 'supplier delivery decision and purchase order state are inconsistent';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "factory_purchase_order_delivery_decision_consistency_check"
  AFTER INSERT OR UPDATE ON "factory_purchase_order_supplier_responses"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW."internal_decision" IS NOT NULL)
  EXECUTE FUNCTION "validate_factory_purchase_order_delivery_decision_consistency"();

-- Shipping is the final delivery freeze. Validate the internal actor and lock
-- every active PO before admitting the handoff.
CREATE OR REPLACE FUNCTION "protect_sales_execution_shipping_anchor"() RETURNS trigger AS $$
DECLARE
  active_purchase_order_count INTEGER;
  invalid_purchase_order_count INTEGER;
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

    SELECT COUNT(*), COUNT(*) FILTER (
      WHERE purchase_order."status" <> 'ACCEPTED'
        OR purchase_order."production_status" <> 'COMPLETED'
        OR purchase_order."production_completed_at" IS NULL
        OR purchase_order."production_completed_by" IS NULL
        OR purchase_order."actual_delivery_date" IS NULL
    )
    INTO active_purchase_order_count, invalid_purchase_order_count
    FROM "factory_purchase_orders" purchase_order
    WHERE purchase_order."execution_id" = NEW."id"
      AND purchase_order."status" <> 'VOIDED';
    IF active_purchase_order_count = 0 OR invalid_purchase_order_count <> 0 THEN
      RAISE EXCEPTION 'shipping requires every active factory purchase order to be accepted, completed and delivered';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
