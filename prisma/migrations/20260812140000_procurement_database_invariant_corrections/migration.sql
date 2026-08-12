BEGIN;

-- This is a forward-only correction for invariants discovered after the
-- 20260809/20260810 migrations had already been applied. Never rewrite those
-- migration files: Prisma validates their recorded checksums.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

-- Keep the audited workflow rows stable while the historical preflights run.
-- SHARE ROW EXCLUSIVE blocks concurrent writes but keeps ordinary reads open.
LOCK TABLE "sales_quotations",
           "sales_quotation_decisions",
           "factory_purchase_orders",
           "factory_purchase_order_supplier_responses",
           "factory_purchase_order_supplier_prices",
           "factory_purchase_order_payments",
           "factory_purchase_order_adjustments",
           "factory_purchase_order_settlements"
  IN SHARE ROW EXCLUSIVE MODE;

-- -------------------------------------------------------------------------
-- Quotation legal identity and manual-decision closure
-- -------------------------------------------------------------------------

DO $$
DECLARE
  invalid_quotation_id TEXT;
BEGIN
  SELECT quotation."id"
  INTO invalid_quotation_id
  FROM "sales_quotations" quotation
  WHERE quotation."business_entity_id" IS NULL
  ORDER BY quotation."id"
  LIMIT 1;

  IF invalid_quotation_id IS NOT NULL THEN
    RAISE EXCEPTION
      'quotation % has no seller business entity; repair it before applying this migration',
      invalid_quotation_id;
  END IF;
END;
$$;

DO $$
DECLARE
  invalid_decision_id TEXT;
BEGIN
  SELECT decision."id"
  INTO invalid_decision_id
  FROM "sales_quotation_decisions" decision
  LEFT JOIN "users" actor ON actor."id" = decision."recorded_by"
  WHERE decision."recorded_by" IS NULL
     OR decision."responded_at" > CURRENT_TIMESTAMP
     OR actor."id" IS NULL
     OR actor."supplier_id" IS NOT NULL
  ORDER BY decision."id"
  LIMIT 1;

  IF invalid_decision_id IS NOT NULL THEN
    RAISE EXCEPTION
      'manual quotation decision % has an incomplete or future-dated audit',
      invalid_decision_id;
  END IF;
END;
$$;

DO $$
DECLARE
  invalid_quotation_id TEXT;
BEGIN
  SELECT quotation."id"
  INTO invalid_quotation_id
  FROM "sales_quotations" quotation
  LEFT JOIN "sales_quotation_versions" version
    ON version."quotation_id" = quotation."id"
   AND version."version_number" = quotation."current_version_number"
  LEFT JOIN "sales_quotation_decisions" decision
    ON decision."quotation_version_id" = version."id"
  WHERE version."id" IS NULL
     OR (
       quotation."status" IN ('ACCEPTED', 'REJECTED')
       AND (
         decision."id" IS NULL
         OR decision."decision"::TEXT IS DISTINCT FROM quotation."status"::TEXT
       )
     )
     OR (
       quotation."status" IN ('DRAFT', 'SENT')
       AND decision."id" IS NOT NULL
     )
  ORDER BY quotation."id"
  LIMIT 1;

  IF invalid_quotation_id IS NOT NULL THEN
    RAISE EXCEPTION
      'quotation % status and current-version decision are inconsistent',
      invalid_quotation_id;
  END IF;
END;
$$;

ALTER TABLE "sales_quotations"
  ALTER COLUMN "business_entity_id" SET NOT NULL;

ALTER TABLE "sales_quotation_decisions"
  ALTER COLUMN "recorded_by" SET NOT NULL,
  DROP CONSTRAINT IF EXISTS "sales_quotation_decisions_recorded_by_fkey";

ALTER TABLE "sales_quotation_decisions"
  ADD CONSTRAINT "sales_quotation_decisions_recorded_by_fkey"
    FOREIGN KEY ("recorded_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "validate_sales_quotation_decision_insert"() RETURNS trigger AS $$
DECLARE
  quotation_record RECORD;
BEGIN
  IF NEW."channel" = 'SYSTEM_EMAIL' THEN
    RAISE EXCEPTION 'PI email delivery cannot confirm a quotation; use manual confirmation';
  END IF;
  IF NEW."delivery_id" IS NOT NULL THEN
    RAISE EXCEPTION 'manual quotation decision cannot reference a system delivery';
  END IF;

  SELECT quotation."status", version."id" AS current_version_id,
         EXISTS (
           SELECT 1
           FROM "users" actor
           WHERE actor."id" = NEW."recorded_by"
             AND actor."supplier_id" IS NULL
             AND actor."is_active" = TRUE
             AND actor."approval_status" = 'APPROVED'
             AND actor."deleted_at" IS NULL
         ) AS actor_valid
  INTO quotation_record
  FROM "sales_quotations" quotation
  JOIN "sales_quotation_versions" version
    ON version."quotation_id" = quotation."id"
   AND version."version_number" = quotation."current_version_number"
  WHERE quotation."id" = NEW."quotation_id"
  FOR KEY SHARE OF quotation, version;

  IF NOT FOUND
    OR quotation_record.current_version_id IS DISTINCT FROM NEW."quotation_version_id"
    OR quotation_record."status"::TEXT IS DISTINCT FROM NEW."decision"::TEXT
    OR quotation_record.actor_valid IS NOT TRUE
    OR NEW."responded_at" > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION
      'manual quotation decision must match the current version, status and an active internal operator';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "assert_sales_quotation_decision_commit_consistency"() RETURNS trigger AS $$
DECLARE
  target_quotation_id TEXT;
  quotation_record RECORD;
BEGIN
  target_quotation_id := CASE
    WHEN TG_TABLE_NAME = 'sales_quotations' THEN
      CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END
    ELSE
      CASE WHEN TG_OP = 'DELETE' THEN OLD."quotation_id" ELSE NEW."quotation_id" END
  END;

  SELECT quotation."status", version."id" AS current_version_id,
         decision."decision" AS current_decision
  INTO quotation_record
  FROM "sales_quotations" quotation
  LEFT JOIN "sales_quotation_versions" version
    ON version."quotation_id" = quotation."id"
   AND version."version_number" = quotation."current_version_number"
  LEFT JOIN "sales_quotation_decisions" decision
    ON decision."quotation_version_id" = version."id"
  WHERE quotation."id" = target_quotation_id;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF quotation_record.current_version_id IS NULL THEN
    RAISE EXCEPTION 'quotation current version does not exist';
  END IF;
  IF quotation_record."status" IN ('ACCEPTED', 'REJECTED') AND (
    quotation_record.current_decision IS NULL
    OR quotation_record.current_decision::TEXT IS DISTINCT FROM quotation_record."status"::TEXT
  ) THEN
    RAISE EXCEPTION
      'quotation accepted or rejected status requires a matching current-version decision';
  END IF;
  IF quotation_record."status" IN ('DRAFT', 'SENT')
    AND quotation_record.current_decision IS NOT NULL THEN
    RAISE EXCEPTION 'draft or sent quotation cannot have a current-version decision';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sales_quotations_decision_commit_consistency"
  ON "sales_quotations";
CREATE CONSTRAINT TRIGGER "sales_quotations_decision_commit_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "sales_quotations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_sales_quotation_decision_commit_consistency"();

DROP TRIGGER IF EXISTS "sales_quotation_decisions_commit_consistency"
  ON "sales_quotation_decisions";
CREATE CONSTRAINT TRIGGER "sales_quotation_decisions_commit_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "sales_quotation_decisions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_sales_quotation_decision_commit_consistency"();

-- -------------------------------------------------------------------------
-- Supplier response and price attribution
-- -------------------------------------------------------------------------

DO $$
DECLARE
  invalid_price_id TEXT;
BEGIN
  SELECT price."id"
  INTO invalid_price_id
  FROM "factory_purchase_order_supplier_prices" price
  LEFT JOIN "factory_purchase_order_items" item
    ON item."id" = price."purchase_order_item_id"
   AND item."purchase_order_id" = price."purchase_order_id"
  LEFT JOIN "factory_purchase_orders" purchase_order
    ON purchase_order."id" = price."purchase_order_id"
  LEFT JOIN "factory_purchase_order_supplier_responses" response
    ON response."id" = price."supplier_response_id"
   AND response."purchase_order_id" = price."purchase_order_id"
  WHERE response."id" IS NULL
     OR item."id" IS NULL
     OR response."action" = 'REJECTED'
     OR item."purchase_unit_price" IS NOT NULL
     OR price."amount" IS DISTINCT FROM ROUND(item."allocated_quantity" * price."unit_price", 2)
     OR response."response_sequence" > purchase_order."supplier_response_sequence"
     OR price."confirmed_by" IS DISTINCT FROM response."responded_by"
     OR price."confirmed_at" IS DISTINCT FROM response."responded_at"
  ORDER BY price."id"
  LIMIT 1;

  IF invalid_price_id IS NOT NULL THEN
    RAISE EXCEPTION
      'supplier price % is not attributable to its supplier response',
      invalid_price_id;
  END IF;
END;
$$;

DO $$
DECLARE
  invalid_response_id TEXT;
BEGIN
  SELECT purchase_order."id"
  INTO invalid_response_id
  FROM "factory_purchase_orders" purchase_order
  LEFT JOIN "factory_purchase_order_supplier_responses" response
    ON response."purchase_order_id" = purchase_order."id"
   AND response."response_sequence" = purchase_order."supplier_response_sequence"
  WHERE (
      purchase_order."supplier_response_sequence" = 0
      AND response."id" IS NOT NULL
    )
    OR (
      purchase_order."supplier_response_sequence" > 0
      AND (
        response."id" IS NULL
        OR response."remark" IS DISTINCT FROM purchase_order."supplier_response_remark"
        OR response."responded_at" IS DISTINCT FROM purchase_order."responded_at"
        OR response."responded_by" IS DISTINCT FROM purchase_order."responded_by"
        OR (
          purchase_order."status" <> 'VOIDED'
          AND (
            (
              response."internal_decision" IS NULL
              AND response."action" IS DISTINCT FROM purchase_order."status"::TEXT
            )
            OR (
              response."internal_decision" = 'ACCEPTED'
              AND purchase_order."status" <> 'ACCEPTED'
            )
            OR (
              response."internal_decision" = 'REJECTED'
              AND purchase_order."status" NOT IN ('ACCEPTED', 'DISPATCHED')
            )
            OR (
              (
                response."action" <> 'DELIVERY_PROPOSED'
                OR response."internal_decision" = 'ACCEPTED'
              )
              AND response."delivery_date" IS DISTINCT FROM purchase_order."supplier_delivery_date"
            )
          )
        )
      )
    )
    OR EXISTS (
      SELECT 1
      FROM "factory_purchase_order_supplier_responses" future_response
      WHERE future_response."purchase_order_id" = purchase_order."id"
        AND future_response."response_sequence" > purchase_order."supplier_response_sequence"
    )
  ORDER BY purchase_order."id"
  LIMIT 1;

  IF invalid_response_id IS NOT NULL THEN
    RAISE EXCEPTION
      'purchase order % and its latest supplier response are inconsistent',
      invalid_response_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_supplier_price"() RETURNS trigger AS $$
DECLARE
  parent_status "FactoryPurchaseOrderStatus";
  parent_response_sequence INTEGER;
  original_unit_price DECIMAL(18,6);
  allocated_quantity DECIMAL(18,4);
  response_sequence INTEGER;
  response_actor_id TEXT;
  response_time TIMESTAMP(3);
BEGIN
  SELECT purchase_order."status", purchase_order."supplier_response_sequence",
         item."purchase_unit_price", item."allocated_quantity",
         response."response_sequence", response."responded_by", response."responded_at"
  INTO parent_status, parent_response_sequence, original_unit_price,
       allocated_quantity, response_sequence, response_actor_id, response_time
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
      'supplier price must belong to the current supplier response and its real operator';
  END IF;
  IF original_unit_price IS NOT NULL THEN
    RAISE EXCEPTION 'supplier price cannot replace the dispatched purchase unit price';
  END IF;
  IF NEW."amount" <> ROUND(allocated_quantity * NEW."unit_price", 2) THEN
    RAISE EXCEPTION 'supplier price amount must equal quantity multiplied by unit price';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_supplier_response_consistency"() RETURNS trigger AS $$
DECLARE
  purchase_order RECORD;
BEGIN
  SELECT "status", "supplier_response_sequence", "supplier_delivery_date",
         "supplier_response_remark", "responded_at", "responded_by"
  INTO purchase_order
  FROM "factory_purchase_orders"
  WHERE "id" = NEW."purchase_order_id";

  IF NOT FOUND
    OR purchase_order."supplier_response_sequence" <> NEW."response_sequence"
    OR purchase_order."status"::TEXT IS DISTINCT FROM NEW."action"
    OR purchase_order."supplier_response_remark" IS DISTINCT FROM NEW."remark"
    OR purchase_order."responded_at" IS DISTINCT FROM NEW."responded_at"
    OR purchase_order."responded_by" IS DISTINCT FROM NEW."responded_by"
    OR (
      NEW."action" <> 'DELIVERY_PROPOSED'
      AND purchase_order."supplier_delivery_date" IS DISTINCT FROM NEW."delivery_date"
    ) THEN
    RAISE EXCEPTION 'supplier response and purchase order state are inconsistent';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "factory_purchase_order_supplier_response_consistency_check"
  ON "factory_purchase_order_supplier_responses";
CREATE CONSTRAINT TRIGGER "factory_purchase_order_supplier_response_consistency_check"
  AFTER INSERT ON "factory_purchase_order_supplier_responses"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "validate_factory_purchase_order_supplier_response_consistency"();

-- -------------------------------------------------------------------------
-- Production start, financial ledgers and void lifecycle
-- -------------------------------------------------------------------------

DO $$
DECLARE
  invalid_purchase_order_id TEXT;
BEGIN
  SELECT purchase_order."id"
  INTO invalid_purchase_order_id
  FROM "factory_purchase_orders" purchase_order
  LEFT JOIN "users" actor ON actor."id" = purchase_order."production_started_by"
  WHERE purchase_order."production_started_at" IS NOT NULL
    AND (
      purchase_order."production_started_by" IS NULL
      OR actor."id" IS NULL
      OR actor."supplier_id" IS NOT NULL
      OR purchase_order."production_started_at" > CURRENT_TIMESTAMP
      OR purchase_order."status" NOT IN ('ACCEPTED', 'DELIVERY_PROPOSED')
      OR NOT EXISTS (
        SELECT 1
        FROM "factory_purchase_order_supplier_responses" accepted_response
        WHERE accepted_response."purchase_order_id" = purchase_order."id"
          AND accepted_response."delivery_date" IS NOT NULL
          AND (
            (
              accepted_response."action" = 'ACCEPTED'
              AND accepted_response."responded_at" <= purchase_order."production_started_at"
            )
            OR (
              accepted_response."action" = 'DELIVERY_PROPOSED'
              AND accepted_response."internal_decision" = 'ACCEPTED'
              AND accepted_response."internal_decided_at" <= purchase_order."production_started_at"
            )
          )
      )
    )
  ORDER BY purchase_order."id"
  LIMIT 1;

  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION
      'started purchase order % has an invalid production-start audit',
      invalid_purchase_order_id;
  END IF;
END;
$$;

-- Recalculate only still-unfrozen purchase anchors. The source delivery must
-- be genuinely accepted; an unresolved delivery proposal is not a promise.
WITH first_accepted_delivery AS (
  SELECT DISTINCT ON (response."purchase_order_id")
    response."purchase_order_id",
    response."delivery_date"
  FROM "factory_purchase_order_supplier_responses" response
  WHERE response."action" = 'ACCEPTED'
    AND response."delivery_date" IS NOT NULL
  ORDER BY response."purchase_order_id", response."response_sequence" ASC
)
UPDATE "factory_purchase_orders" purchase_order
SET "initial_supplier_delivery_date" = first_accepted_delivery."delivery_date"
FROM first_accepted_delivery
WHERE purchase_order."id" = first_accepted_delivery."purchase_order_id"
  AND purchase_order."initial_supplier_delivery_date" IS NULL;

WITH order_totals AS (
  SELECT
    purchase_order."id" AS purchase_order_id,
    CASE
      WHEN COUNT(item."id") = 0
        OR COUNT(*) FILTER (
          WHERE COALESCE(supplier_price."amount", item."amount") IS NULL
        ) > 0
      THEN NULL
      ELSE ROUND(SUM(COALESCE(supplier_price."amount", item."amount")), 2)
    END AS penalty_base_amount
  FROM "factory_purchase_orders" purchase_order
  LEFT JOIN "factory_purchase_order_items" item
    ON item."purchase_order_id" = purchase_order."id"
  LEFT JOIN "factory_purchase_order_supplier_prices" supplier_price
    ON supplier_price."purchase_order_id" = purchase_order."id"
   AND supplier_price."purchase_order_item_id" = item."id"
  GROUP BY purchase_order."id"
)
UPDATE "factory_purchase_orders" purchase_order
SET "penalty_base_amount" = order_totals.penalty_base_amount
FROM order_totals
WHERE purchase_order."id" = order_totals.purchase_order_id
  AND purchase_order."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED')
  AND purchase_order."confirmed_supplier_delivery_date" IS NOT NULL
  AND purchase_order."initial_supplier_delivery_date" IS NOT NULL
  AND purchase_order."penalty_base_amount" IS NULL
  AND order_totals.penalty_base_amount IS NOT NULL;

DO $$
DECLARE
  invalid_purchase_order_id TEXT;
BEGIN
  SELECT purchase_order."id"
  INTO invalid_purchase_order_id
  FROM "factory_purchase_orders" purchase_order
  WHERE purchase_order."production_status" IN (
      'WAITING_PREPAYMENT', 'READY', 'IN_PRODUCTION', 'COMPLETED'
    )
    AND (
      purchase_order."initial_supplier_delivery_date" IS NULL
      OR purchase_order."penalty_base_amount" IS NULL
    )
  ORDER BY purchase_order."id"
  LIMIT 1;

  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION
      'purchase order % has active production without frozen delivery and amount anchors',
      invalid_purchase_order_id;
  END IF;
END;
$$;

ALTER TABLE "factory_purchase_orders"
  DROP CONSTRAINT IF EXISTS "factory_purchase_orders_execution_anchor_check";
ALTER TABLE "factory_purchase_orders"
  ADD CONSTRAINT "factory_purchase_orders_execution_anchor_check" CHECK (
    "production_status" = 'WAITING_SUPPLIER'
    OR (
      "production_status" IN ('WAITING_PREPAYMENT', 'READY', 'IN_PRODUCTION', 'COMPLETED')
      AND "initial_supplier_delivery_date" IS NOT NULL
      AND "penalty_base_amount" IS NOT NULL
    )
  );

DO $$
DECLARE
  invalid_purchase_order_id TEXT;
BEGIN
  SELECT purchase_order."id"
  INTO invalid_purchase_order_id
  FROM "factory_purchase_orders" purchase_order
  WHERE (
      EXISTS (
        SELECT 1
        FROM "factory_purchase_order_payments" payment
        WHERE payment."purchase_order_id" = purchase_order."id"
          AND payment."status" = 'CONFIRMED'
      )
      OR EXISTS (
        SELECT 1
        FROM "factory_purchase_order_adjustments" adjustment
        WHERE adjustment."purchase_order_id" = purchase_order."id"
          AND adjustment."status" <> 'VOIDED'
      )
      OR EXISTS (
        SELECT 1
        FROM "factory_purchase_order_settlements" settlement
        WHERE settlement."purchase_order_id" = purchase_order."id"
      )
    )
    AND (
      purchase_order."status" NOT IN ('ACCEPTED', 'DELIVERY_PROPOSED')
      OR purchase_order."confirmed_supplier_delivery_date" IS NULL
      OR purchase_order."initial_supplier_delivery_date" IS NULL
      OR purchase_order."penalty_base_amount" IS NULL
    )
  ORDER BY purchase_order."id"
  LIMIT 1;

  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION
      'purchase order % has a ledger without accepted delivery and frozen amount anchors',
      invalid_purchase_order_id;
  END IF;
END;
$$;

DO $$
DECLARE
  invalid_purchase_order_id TEXT;
BEGIN
  SELECT purchase_order."id"
  INTO invalid_purchase_order_id
  FROM "factory_purchase_orders" purchase_order
  WHERE purchase_order."status" = 'VOIDED'
    AND (
      purchase_order."production_started_at" IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM "factory_purchase_order_payments" payment
        WHERE payment."purchase_order_id" = purchase_order."id"
          AND payment."status" = 'CONFIRMED'
      )
      OR EXISTS (
        SELECT 1
        FROM "factory_purchase_order_adjustments" adjustment
        WHERE adjustment."purchase_order_id" = purchase_order."id"
          AND adjustment."status" <> 'VOIDED'
      )
      OR EXISTS (
        SELECT 1
        FROM "factory_purchase_order_settlements" settlement
        WHERE settlement."purchase_order_id" = purchase_order."id"
      )
    )
  ORDER BY purchase_order."id"
  LIMIT 1;

  IF invalid_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION
      'voided purchase order % retains production or active financial commitments',
      invalid_purchase_order_id;
  END IF;
END;
$$;

DO $$
DECLARE
  orphan_cost_id TEXT;
BEGIN
  SELECT cost."id"
  INTO orphan_cost_id
  FROM "order_costs" cost
  LEFT JOIN "factory_purchase_order_settlements" settlement
    ON settlement."purchase_order_id" = cost."source_id"
  WHERE cost."source_type" = 'FACTORY_PURCHASE_SETTLEMENT'
    AND settlement."id" IS NULL
  ORDER BY cost."id"
  LIMIT 1;

  IF orphan_cost_id IS NOT NULL THEN
    RAISE EXCEPTION
      'factory settlement cost % has no matching immutable settlement',
      orphan_cost_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_start_actor"() RETURNS trigger AS $$
DECLARE
  actor_valid BOOLEAN := false;
BEGIN
  IF NEW."production_status" = 'IN_PRODUCTION'
    AND OLD."production_status" IS DISTINCT FROM 'IN_PRODUCTION' THEN
    SELECT TRUE
    INTO actor_valid
    FROM "users" actor
    WHERE actor."id" = NEW."production_started_by"
      AND actor."supplier_id" IS NULL
      AND actor."is_active" = TRUE
      AND actor."approval_status" = 'APPROVED'
      AND actor."deleted_at" IS NULL
    FOR SHARE OF actor;

    IF OLD."production_status" <> 'READY'
      OR NEW."status" <> 'ACCEPTED'
      OR NEW."production_started_at" IS NULL
      OR NEW."production_started_by" IS NULL
      OR NEW."production_started_at" > CURRENT_TIMESTAMP
      OR OLD."responded_at" IS NULL
      OR NEW."production_started_at" < OLD."responded_at"
      OR actor_valid IS NOT TRUE THEN
      RAISE EXCEPTION
        'production start requires an accepted order and an active internal operator';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "factory_purchase_orders_production_start_actor_guard"
  ON "factory_purchase_orders";
CREATE TRIGGER "factory_purchase_orders_production_start_actor_guard"
  BEFORE UPDATE OF "production_status", "production_started_at", "production_started_by"
  ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_production_start_actor"();

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_ledger_parent"() RETURNS trigger AS $$
DECLARE
  parent RECORD;
BEGIN
  SELECT purchase_order."status", purchase_order."confirmed_supplier_delivery_date",
         purchase_order."initial_supplier_delivery_date", purchase_order."penalty_base_amount"
  INTO parent
  FROM "factory_purchase_orders" purchase_order
  WHERE purchase_order."id" = NEW."purchase_order_id"
  FOR UPDATE;

  IF NOT FOUND
    OR parent."status" NOT IN ('ACCEPTED', 'DELIVERY_PROPOSED')
    OR parent."confirmed_supplier_delivery_date" IS NULL
    OR parent."initial_supplier_delivery_date" IS NULL
    OR parent."penalty_base_amount" IS NULL THEN
    RAISE EXCEPTION
      'factory purchase order ledger requires an internally accepted delivery and frozen amount';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_adjustment"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase order adjustments cannot be deleted';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'voided factory purchase order adjustment is immutable';
  END IF;
  IF NEW."purchase_order_id" IS DISTINCT FROM OLD."purchase_order_id"
    OR NEW."sequence_no" IS DISTINCT FROM OLD."sequence_no"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."direction" IS DISTINCT FROM OLD."direction"
    OR NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at"
    OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
    OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'factory purchase order adjustment core fields are immutable';
  END IF;
  IF OLD."status" = 'CONFIRMED' AND NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'confirmed factory purchase order adjustment may only be voided';
  END IF;
  IF OLD."status" = 'PROVISIONAL'
    AND NEW."status" NOT IN ('CONFIRMED', 'VOIDED') THEN
    RAISE EXCEPTION 'factory purchase order adjustment may only be confirmed or voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_void_after_commitment"() RETURNS trigger AS $$
DECLARE
  shipping_started_at TIMESTAMP(3);
  has_receivable_order BOOLEAN;
  has_settlement BOOLEAN;
  has_financial_commitment BOOLEAN;
BEGIN
  IF OLD."status" = NEW."status"
    OR NEW."status" <> 'VOIDED'::"FactoryPurchaseOrderStatus" THEN
    RETURN NEW;
  END IF;

  SELECT execution."shipping_started_at",
         EXISTS (
           SELECT 1
           FROM "receivable_orders" receivable_order
           WHERE receivable_order."source_sales_execution_id" = execution."id"
             AND receivable_order."deleted_at" IS NULL
         )
  INTO shipping_started_at, has_receivable_order
  FROM "sales_executions" execution
  WHERE execution."id" = NEW."execution_id";

  SELECT EXISTS (
    SELECT 1
    FROM "factory_purchase_order_settlements" settlement
    WHERE settlement."purchase_order_id" = NEW."id"
  ) INTO has_settlement;

  SELECT EXISTS (
    SELECT 1
    FROM "factory_purchase_order_payments" payment
    WHERE payment."purchase_order_id" = NEW."id"
      AND payment."status" = 'CONFIRMED'
  ) OR EXISTS (
    SELECT 1
    FROM "factory_purchase_order_adjustments" adjustment
    WHERE adjustment."purchase_order_id" = NEW."id"
      AND adjustment."status" <> 'VOIDED'
  ) INTO has_financial_commitment;

  IF has_settlement
    OR has_financial_commitment
    OR OLD."production_started_at" IS NOT NULL
    OR shipping_started_at IS NOT NULL
    OR has_receivable_order
    OR OLD."actual_delivery_date" IS NOT NULL THEN
    RAISE EXCEPTION
      'purchase order with production, delivery or financial commitments cannot be voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
