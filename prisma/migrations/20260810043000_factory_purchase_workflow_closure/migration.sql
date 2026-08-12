BEGIN;

ALTER TABLE "factory_purchase_orders"
  ADD COLUMN "replacement_for_id" TEXT,
  ADD COLUMN "confirmed_supplier_delivery_date" DATE,
  ADD COLUMN "actual_delivery_date" DATE,
  ADD COLUMN "actual_delivery_recorded_at" TIMESTAMP(3),
  ADD COLUMN "actual_delivery_recorded_by" TEXT;

CREATE UNIQUE INDEX "factory_purchase_orders_replacement_for_id_key"
  ON "factory_purchase_orders"("replacement_for_id");
CREATE INDEX "factory_purchase_orders_actual_delivery_recorded_by_idx"
  ON "factory_purchase_orders"("actual_delivery_recorded_by");
CREATE INDEX "factory_purchase_orders_actual_delivery_date_idx"
  ON "factory_purchase_orders"("actual_delivery_date");

ALTER TABLE "factory_purchase_orders"
  ADD CONSTRAINT "factory_purchase_orders_replacement_for_id_fkey"
    FOREIGN KEY ("replacement_for_id") REFERENCES "factory_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_orders_actual_delivery_recorded_by_fkey"
    FOREIGN KEY ("actual_delivery_recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_orders_actual_delivery_audit_check" CHECK (
    (
      "actual_delivery_date" IS NULL
      AND "actual_delivery_recorded_at" IS NULL
      AND "actual_delivery_recorded_by" IS NULL
    ) OR (
      "actual_delivery_date" IS NOT NULL
      AND "actual_delivery_recorded_at" IS NOT NULL
      AND "actual_delivery_recorded_by" IS NOT NULL
    )
  );

UPDATE "factory_purchase_orders"
SET "confirmed_supplier_delivery_date" = COALESCE("supplier_delivery_date", "initial_supplier_delivery_date")
WHERE "status" IN ('ACCEPTED', 'DELIVERY_PROPOSED')
  AND "confirmed_supplier_delivery_date" IS NULL;

ALTER TABLE "factory_purchase_order_supplier_responses"
  ADD COLUMN "internal_decision" TEXT,
  ADD COLUMN "internal_decision_remark" TEXT,
  ADD COLUMN "internal_decided_at" TIMESTAMP(3),
  ADD COLUMN "internal_decided_by" TEXT;

CREATE INDEX "fpo_supplier_response_internal_decider_idx"
  ON "factory_purchase_order_supplier_responses"("internal_decided_by");
ALTER TABLE "factory_purchase_order_supplier_responses"
  ADD CONSTRAINT "fpo_supplier_response_internal_decided_by_fkey"
    FOREIGN KEY ("internal_decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fpo_supplier_response_internal_decision_check" CHECK (
    (
      "internal_decision" IS NULL
      AND "internal_decision_remark" IS NULL
      AND "internal_decided_at" IS NULL
      AND "internal_decided_by" IS NULL
    ) OR (
      "internal_decision" IN ('ACCEPTED', 'REJECTED')
      AND "internal_decided_at" IS NOT NULL
      AND "internal_decided_by" IS NOT NULL
      AND (
        "internal_decision" = 'ACCEPTED'
        OR NULLIF(BTRIM("internal_decision_remark"), '') IS NOT NULL
      )
    )
  );

CREATE TYPE "FactoryPurchaseSettlementStatus" AS ENUM ('PENDING_PAYMENT', 'SETTLED');

CREATE TABLE "factory_purchase_order_settlements" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "base_amount" DECIMAL(18,2) NOT NULL,
  "increase_amount" DECIMAL(18,2) NOT NULL,
  "decrease_amount" DECIMAL(18,2) NOT NULL,
  "delay_days" INTEGER NOT NULL,
  "delay_penalty_amount" DECIMAL(18,2) NOT NULL,
  "final_payable_amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "exchange_rate" DECIMAL(18,6) NOT NULL,
  "exchange_rate_date" DATE NOT NULL,
  "paid_amount_at_settlement" DECIMAL(18,2) NOT NULL,
  "status" "FactoryPurchaseSettlementStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "settled_at" TIMESTAMP(3),
  "settled_by" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "factory_purchase_order_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "factory_purchase_order_settlements_amount_check" CHECK (
    "base_amount" >= 0
    AND "increase_amount" >= 0
    AND "decrease_amount" >= 0
    AND "delay_days" >= 0
    AND "delay_penalty_amount" >= 0
    AND "final_payable_amount" >= 0
    AND "exchange_rate" > 0
    AND "paid_amount_at_settlement" >= 0
    AND "paid_amount_at_settlement" <= "final_payable_amount"
  ),
  CONSTRAINT "factory_purchase_order_settlements_state_check" CHECK (
    (
      "status" = 'PENDING_PAYMENT'
      AND "settled_at" IS NULL
      AND "settled_by" IS NULL
      AND "paid_amount_at_settlement" < "final_payable_amount"
    ) OR (
      "status" = 'SETTLED'
      AND "settled_at" IS NOT NULL
      AND "settled_by" IS NOT NULL
      AND "paid_amount_at_settlement" = "final_payable_amount"
    )
  )
);

CREATE UNIQUE INDEX "factory_purchase_order_settlements_purchase_order_id_key"
  ON "factory_purchase_order_settlements"("purchase_order_id");
CREATE INDEX "factory_purchase_order_settlements_status_updated_at_idx"
  ON "factory_purchase_order_settlements"("status", "updated_at");
CREATE INDEX "factory_purchase_order_settlements_settled_by_idx"
  ON "factory_purchase_order_settlements"("settled_by");
CREATE INDEX "factory_purchase_order_settlements_created_by_idx"
  ON "factory_purchase_order_settlements"("created_by");

ALTER TABLE "factory_purchase_order_settlements"
  ADD CONSTRAINT "factory_purchase_order_settlements_purchase_order_id_fkey"
    FOREIGN KEY ("purchase_order_id") REFERENCES "factory_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_settlements_settled_by_fkey"
    FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_settlements_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A rejected purchase order can be replaced inside a dispatched execution, but
-- only by a fresh draft that points to the rejected/voided row in the same
-- execution. Items are inserted while the replacement remains a draft.
CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_execution_parent"() RETURNS trigger AS $$
DECLARE
  parent_status "SalesExecutionStatus";
  replacement_valid BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
    RAISE EXCEPTION 'factory purchase orders must start as drafts';
  END IF;

  SELECT "status" INTO parent_status
  FROM "sales_executions"
  WHERE "id" = NEW."execution_id"
  FOR KEY SHARE;

  IF parent_status = 'DISPATCHED'::"SalesExecutionStatus"
    AND NEW."replacement_for_id" IS NOT NULL THEN
    SELECT TRUE INTO replacement_valid
    FROM "factory_purchase_orders" replaced_order
    WHERE replaced_order."id" = NEW."replacement_for_id"
      AND replaced_order."execution_id" = NEW."execution_id"
      AND replaced_order."status" IN ('REJECTED', 'VOIDED')
    FOR KEY SHARE;
  END IF;

  IF parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus"
    AND COALESCE(replacement_valid, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'factory purchase orders can only be created in draft executions or as valid rejected-order replacements';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_status_transition"() RETURNS trigger AS $$
DECLARE
  response_changed BOOLEAN;
  internal_delivery_decision BOOLEAN;
BEGIN
  response_changed :=
    NEW."supplier_response_sequence" IS DISTINCT FROM OLD."supplier_response_sequence"
    OR NEW."supplier_delivery_date" IS DISTINCT FROM OLD."supplier_delivery_date"
    OR NEW."supplier_response_remark" IS DISTINCT FROM OLD."supplier_response_remark"
    OR NEW."responded_at" IS DISTINCT FROM OLD."responded_at"
    OR NEW."responded_by" IS DISTINCT FROM OLD."responded_by";

  internal_delivery_decision :=
    OLD."status" = 'DELIVERY_PROPOSED'
    AND NEW."status" IN ('ACCEPTED', 'DISPATCHED')
    AND response_changed IS FALSE;

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

  IF internal_delivery_decision THEN
    IF NEW."status" = 'ACCEPTED'
      AND NEW."confirmed_supplier_delivery_date" IS DISTINCT FROM OLD."supplier_delivery_date" THEN
      RAISE EXCEPTION 'accepted delivery proposal must become the confirmed delivery date';
    END IF;
    IF NEW."status" = 'DISPATCHED'
      AND NEW."confirmed_supplier_delivery_date" IS DISTINCT FROM OLD."confirmed_supplier_delivery_date" THEN
      RAISE EXCEPTION 'rejected first delivery proposal cannot alter the confirmed delivery date';
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
    IF OLD."status" = 'ACCEPTED'
      AND NEW."supplier_delivery_date" IS NOT DISTINCT FROM OLD."supplier_delivery_date" THEN
      RAISE EXCEPTION 'later supplier delivery date must change';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "factory_purchase_order_supplier_responses" response
      WHERE response."purchase_order_id" = NEW."id"
        AND response."response_sequence" = NEW."supplier_response_sequence"
        AND response."action" = NEW."status"::TEXT
        AND response."delivery_date" IS NOT DISTINCT FROM NEW."supplier_delivery_date"
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
      OR NEW."initial_supplier_delivery_date" IS DISTINCT FROM OLD."initial_supplier_delivery_date"
      OR NEW."penalty_base_amount" IS DISTINCT FROM OLD."penalty_base_amount"
      OR NEW."production_status" IS DISTINCT FROM OLD."production_status"
    ) THEN
      RAISE EXCEPTION 'pending delivery proposal cannot change confirmed delivery or production anchors';
    END IF;
  ELSIF OLD."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED') AND response_changed THEN
    RAISE EXCEPTION 'supplier response fields require a new delivery proposal';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_supplier_response"() RETURNS trigger AS $$
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
  ELSIF NEW."internal_decision" IS NULL THEN
    IF NEW."internal_decision_remark" IS NOT NULL
      OR NEW."internal_decided_at" IS NOT NULL
      OR NEW."internal_decided_by" IS NOT NULL THEN
      RAISE EXCEPTION 'supplier delivery decision audit is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_supplier_purchase_order_response_actor"() RETURNS trigger AS $$
DECLARE
  response_actor_valid BOOLEAN := false;
  parent_production_status "FactoryPurchaseOrderProductionStatus";
  parent_status "FactoryPurchaseOrderStatus";
BEGIN
  SELECT purchase_order."production_status", purchase_order."status"
  INTO parent_production_status, parent_status
  FROM "factory_purchase_orders" purchase_order
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
  FOR SHARE OF purchase_order, response_user, response_supplier;
  response_actor_valid := FOUND;

  IF response_actor_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'supplier response requires an active approved operator for the purchase order supplier';
  END IF;
  IF parent_production_status = 'COMPLETED' THEN
    RAISE EXCEPTION 'completed factory purchase order delivery is frozen';
  END IF;
  IF parent_status = 'DELIVERY_PROPOSED' THEN
    RAISE EXCEPTION 'pending delivery proposal requires an internal decision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_supplier_response_actor_guard"
  BEFORE INSERT ON "factory_purchase_order_supplier_responses"
  FOR EACH ROW EXECUTE FUNCTION "validate_supplier_purchase_order_response_actor"();

CREATE OR REPLACE FUNCTION "protect_supplier_factory_purchase_order_completion"() RETURNS trigger AS $$
DECLARE
  completion_actor_valid BOOLEAN := false;
  required_prepayment DECIMAL(18,2);
  paid_prepayment DECIMAL(18,2);
BEGIN
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
      OR NEW."production_completed_at" < OLD."production_started_at" THEN
      RAISE EXCEPTION 'factory purchase order completion state is invalid';
    END IF;
    SELECT TRUE INTO completion_actor_valid
    FROM "users" completion_user
    JOIN "suppliers" completion_supplier ON completion_supplier."id" = completion_user."supplier_id"
    WHERE completion_user."id" = NEW."production_completed_by"
      AND completion_user."supplier_id" = NEW."supplier_id"
      AND completion_user."role" IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
      AND completion_user."is_active" = TRUE
      AND completion_user."approval_status" = 'APPROVED'
      AND completion_user."deleted_at" IS NULL
      AND completion_supplier."supplier_type" IN ('产品供应商', '工厂供应商', 'PRODUCT')
      AND completion_supplier."status" = '启用'
      AND completion_supplier."allow_factory_document_upload" = TRUE
      AND completion_supplier."deleted_at" IS NULL
    FOR SHARE OF completion_user, completion_supplier;
    IF COALESCE(completion_actor_valid, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'factory purchase order production completion requires an active approved supplier operator';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_factory_purchase_order_settlement_insert"() RETURNS trigger AS $$
DECLARE
  purchase_order RECORD;
BEGIN
  SELECT purchase_order_row."status", purchase_order_row."production_status",
         purchase_order_row."actual_delivery_date", execution."shipping_started_at"
  INTO purchase_order
  FROM "factory_purchase_orders" purchase_order_row
  JOIN "sales_executions" execution ON execution."id" = purchase_order_row."execution_id"
  WHERE purchase_order_row."id" = NEW."purchase_order_id"
  FOR SHARE OF purchase_order_row, execution;
  IF NOT FOUND
    OR purchase_order."status" <> 'ACCEPTED'
    OR purchase_order."production_status" <> 'COMPLETED'
    OR purchase_order."actual_delivery_date" IS NULL
    OR purchase_order."shipping_started_at" IS NULL THEN
    RAISE EXCEPTION 'factory settlement requires a delivered completed purchase order in shipping';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_settlements_insert_guard"
  BEFORE INSERT ON "factory_purchase_order_settlements"
  FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_settlement_insert"();

CREATE FUNCTION "protect_factory_purchase_order_settlement"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'factory purchase settlements cannot be deleted'; END IF;
  IF OLD."status" = 'SETTLED' THEN RAISE EXCEPTION 'settled factory purchase settlement is immutable'; END IF;
  IF NEW."purchase_order_id" IS DISTINCT FROM OLD."purchase_order_id"
    OR NEW."base_amount" IS DISTINCT FROM OLD."base_amount"
    OR NEW."increase_amount" IS DISTINCT FROM OLD."increase_amount"
    OR NEW."decrease_amount" IS DISTINCT FROM OLD."decrease_amount"
    OR NEW."delay_days" IS DISTINCT FROM OLD."delay_days"
    OR NEW."delay_penalty_amount" IS DISTINCT FROM OLD."delay_penalty_amount"
    OR NEW."final_payable_amount" IS DISTINCT FROM OLD."final_payable_amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."exchange_rate" IS DISTINCT FROM OLD."exchange_rate"
    OR NEW."exchange_rate_date" IS DISTINCT FROM OLD."exchange_rate_date"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'factory purchase settlement financial snapshot is immutable';
  END IF;
  IF NEW."status" <> 'SETTLED'
    OR NEW."paid_amount_at_settlement" <> NEW."final_payable_amount"
    OR NEW."settled_at" IS NULL
    OR NEW."settled_by" IS NULL THEN
    RAISE EXCEPTION 'pending factory purchase settlement may only transition to fully settled';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_settlements_immutability_guard"
  BEFORE UPDATE OR DELETE ON "factory_purchase_order_settlements"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_settlement"();

CREATE FUNCTION "guard_factory_purchase_ledger_after_settlement"() RETURNS trigger AS $$
DECLARE
  settlement_status "FactoryPurchaseSettlementStatus";
  settlement_final DECIMAL(18,2);
  current_paid DECIMAL(18,2);
  target_purchase_order_id TEXT;
BEGIN
  target_purchase_order_id := CASE
    WHEN TG_OP = 'INSERT' THEN NEW."purchase_order_id"
    ELSE OLD."purchase_order_id"
  END;
  SELECT settlement."status", settlement."final_payable_amount"
  INTO settlement_status, settlement_final
  FROM "factory_purchase_order_settlements" settlement
  WHERE settlement."purchase_order_id" = target_purchase_order_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'factory_purchase_order_adjustments' THEN
    RAISE EXCEPTION 'factory purchase order adjustments are frozen after final settlement';
  END IF;
  IF settlement_status = 'SETTLED' THEN
    RAISE EXCEPTION 'factory purchase order payments are frozen after purchase close';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."kind" <> 'BALANCE' OR NEW."status" <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'only confirmed balance payments are allowed after final settlement';
    END IF;
    SELECT COALESCE(SUM(payment."amount"), 0) INTO current_paid
    FROM "factory_purchase_order_payments" payment
    WHERE payment."purchase_order_id" = NEW."purchase_order_id"
      AND payment."status" = 'CONFIRMED';
    IF current_paid + NEW."amount" > settlement_final THEN
      RAISE EXCEPTION 'factory purchase balance payment exceeds the final payable amount';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."kind" <> 'BALANCE' OR NEW."status" <> 'VOIDED' THEN
      RAISE EXCEPTION 'only a pending balance payment may be voided after final settlement';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_payments_settlement_guard"
  BEFORE INSERT OR UPDATE ON "factory_purchase_order_payments"
  FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_ledger_after_settlement"();
CREATE TRIGGER "factory_purchase_order_adjustments_settlement_guard"
  BEFORE INSERT OR UPDATE ON "factory_purchase_order_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_ledger_after_settlement"();

CREATE FUNCTION "protect_factory_settlement_order_cost"() RETURNS trigger AS $$
DECLARE
  settlement_record RECORD;
  confirmed_paid DECIMAL(18,2);
  latest_paid_date DATE;
  expected_payment_status TEXT;
  expected_paid BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."source_type" = 'FACTORY_PURCHASE_SETTLEMENT' THEN
      RAISE EXCEPTION 'factory settlement cost cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."source_type" <> 'FACTORY_PURCHASE_SETTLEMENT' THEN
    IF TG_OP = 'UPDATE' AND OLD."source_type" = 'FACTORY_PURCHASE_SETTLEMENT' THEN
      RAISE EXCEPTION 'factory settlement cost source cannot be changed';
    END IF;
    RETURN NEW;
  END IF;

  SELECT settlement."final_payable_amount", settlement."exchange_rate", settlement."exchange_rate_date",
         settlement."created_by", purchase_order."supplier_id", purchase_order."supplier_name_snapshot",
         purchase_order."actual_delivery_date",
         purchase_order."purchase_currency", purchase_order."po_no", receivable_order."id" AS "receivable_order_id"
  INTO settlement_record
  FROM "factory_purchase_order_settlements" settlement
  JOIN "factory_purchase_orders" purchase_order ON purchase_order."id" = settlement."purchase_order_id"
  JOIN "sales_executions" execution ON execution."id" = purchase_order."execution_id"
  JOIN "receivable_orders" receivable_order
    ON receivable_order."source_sales_execution_id" = execution."id"
   AND receivable_order."deleted_at" IS NULL
  WHERE settlement."purchase_order_id" = NEW."source_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserved factory settlement cost source requires an existing settlement';
  END IF;

  SELECT COALESCE(SUM(payment."amount"), 0), MAX(payment."paid_at")
  INTO confirmed_paid, latest_paid_date
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = NEW."source_id"
    AND payment."status" = 'CONFIRMED';
  IF confirmed_paid > settlement_record."final_payable_amount" THEN
    RAISE EXCEPTION 'factory settlement payments exceed final payable amount';
  END IF;
  expected_payment_status := CASE
    WHEN confirmed_paid = settlement_record."final_payable_amount" THEN '已支付'
    WHEN confirmed_paid > 0 THEN '部分支付'
    ELSE '待支付'
  END;
  expected_paid := confirmed_paid > 0 OR confirmed_paid = settlement_record."final_payable_amount";
  IF latest_paid_date IS NULL AND confirmed_paid = settlement_record."final_payable_amount" THEN
    latest_paid_date := settlement_record."actual_delivery_date";
  END IF;

  IF NEW."order_id" IS DISTINCT FROM settlement_record."receivable_order_id"
    OR NEW."supplier_id" IS DISTINCT FROM settlement_record."supplier_id"
    OR NEW."supplier_name_snapshot" IS DISTINCT FROM settlement_record."supplier_name_snapshot"
    OR NEW."cost_type" <> '工厂货款'
    OR NEW."vendor_name" IS DISTINCT FROM settlement_record."supplier_name_snapshot"
    OR NEW."currency" IS DISTINCT FROM settlement_record."purchase_currency"
    OR NEW."exchange_rate" IS DISTINCT FROM settlement_record."exchange_rate"
    OR NEW."exchange_rate_date" IS DISTINCT FROM settlement_record."exchange_rate_date"
    OR NEW."amount" IS DISTINCT FROM settlement_record."final_payable_amount"
    OR NEW."amount_cny" IS DISTINCT FROM ROUND(settlement_record."final_payable_amount" * settlement_record."exchange_rate", 2)
    OR NEW."cost_confirmed" IS NOT TRUE
    OR NEW."cost_confirmed_at" IS NULL
    OR NEW."source_id" IS NULL
    OR NEW."status" <> 'ACTIVE'
    OR NEW."deleted_at" IS NOT NULL
    OR NEW."created_by" IS DISTINCT FROM settlement_record."created_by"
    OR NEW."remark" IS DISTINCT FROM ('由工厂采购单 ' || settlement_record."po_no" || ' 最终结算自动生成') THEN
    RAISE EXCEPTION 'factory settlement cost does not match its settlement snapshot';
  END IF;
  IF NEW."payment_status" IS DISTINCT FROM expected_payment_status
    OR NEW."paid" IS DISTINCT FROM expected_paid
    OR NEW."payment_date"::DATE IS DISTINCT FROM latest_paid_date
    OR NEW."paid_at"::DATE IS DISTINCT FROM latest_paid_date THEN
    RAISE EXCEPTION 'factory settlement cost payment state must follow the purchase payment ledger';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."order_id" IS DISTINCT FROM OLD."order_id"
    OR NEW."supplier_id" IS DISTINCT FROM OLD."supplier_id"
    OR NEW."supplier_name_snapshot" IS DISTINCT FROM OLD."supplier_name_snapshot"
    OR NEW."cost_type" IS DISTINCT FROM OLD."cost_type"
    OR NEW."vendor_name" IS DISTINCT FROM OLD."vendor_name"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."exchange_rate" IS DISTINCT FROM OLD."exchange_rate"
    OR NEW."exchange_rate_date" IS DISTINCT FROM OLD."exchange_rate_date"
    OR NEW."exchange_rate_source" IS DISTINCT FROM OLD."exchange_rate_source"
    OR NEW."exchange_rate_type" IS DISTINCT FROM OLD."exchange_rate_type"
    OR NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."amount_cny" IS DISTINCT FROM OLD."amount_cny"
    OR NEW."cost_confirmed" IS DISTINCT FROM OLD."cost_confirmed"
    OR NEW."cost_confirmed_at" IS DISTINCT FROM OLD."cost_confirmed_at"
    OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
    OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."remark" IS DISTINCT FROM OLD."remark"
  ) THEN
    RAISE EXCEPTION 'factory settlement cost financial snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "order_costs_factory_settlement_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "order_costs"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_settlement_order_cost"();

COMMIT;
