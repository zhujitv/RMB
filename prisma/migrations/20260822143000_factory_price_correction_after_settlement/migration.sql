BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

LOCK TABLE "factory_purchase_orders",
           "factory_purchase_order_payments",
           "factory_purchase_order_adjustments",
           "factory_purchase_order_settlements",
           "factory_purchase_order_price_corrections",
           "order_costs"
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "factory_purchase_order_settlements"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD COLUMN "settlement_final_payable_before" DECIMAL(18,2),
  ADD COLUMN "settlement_final_payable_after" DECIMAL(18,2),
  ADD COLUMN "settlement_status_before" "FactoryPurchaseSettlementStatus",
  ADD COLUMN "settlement_status_after" "FactoryPurchaseSettlementStatus",
  ADD COLUMN "settlement_revision_before" INTEGER,
  ADD COLUMN "settlement_revision_after" INTEGER,
  ADD COLUMN "settlement_increase_before" DECIMAL(18,2),
  ADD COLUMN "settlement_increase_after" DECIMAL(18,2),
  ADD COLUMN "settlement_decrease_before" DECIMAL(18,2),
  ADD COLUMN "settlement_decrease_after" DECIMAL(18,2),
  ADD COLUMN "settlement_paid_before" DECIMAL(18,2),
  ADD COLUMN "settlement_paid_after" DECIMAL(18,2),
  ADD COLUMN "settlement_settled_at_before" TIMESTAMP(3),
  ADD COLUMN "settlement_settled_at_after" TIMESTAMP(3),
  ADD COLUMN "settlement_settled_by_before" TEXT,
  ADD COLUMN "settlement_settled_by_after" TEXT;

-- Existing ledgers must already agree before the stronger deferred guards are
-- installed. Stop with the exact purchase order instead of allowing a stale
-- settlement/payment/cost snapshot to become an unwriteable production row.
DO $$
DECLARE
  inconsistent_purchase_order_id TEXT;
BEGIN
  SELECT settlement."purchase_order_id"
  INTO inconsistent_purchase_order_id
  FROM "factory_purchase_order_settlements" settlement
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(SUM(adjustment."amount") FILTER (
        WHERE adjustment."status" = 'CONFIRMED'
          AND adjustment."kind" <> 'DELAY_PENALTY'
          AND adjustment."direction" = 'INCREASE'
      ), 0)::NUMERIC(18,2) AS increase_amount,
      COALESCE(SUM(adjustment."amount") FILTER (
        WHERE adjustment."status" = 'CONFIRMED'
          AND adjustment."kind" <> 'DELAY_PENALTY'
          AND adjustment."direction" = 'DECREASE'
      ), 0)::NUMERIC(18,2) AS decrease_amount
    FROM "factory_purchase_order_adjustments" adjustment
    WHERE adjustment."purchase_order_id" = settlement."purchase_order_id"
  ) adjustment_totals
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(SUM(CASE
        WHEN payment."status" <> 'CONFIRMED' THEN 0
        WHEN payment."kind" = 'REFUND' THEN -payment."amount"
        ELSE payment."amount"
      END), 0)::NUMERIC(18,2) AS net_paid,
      MAX(payment."paid_at") FILTER (WHERE payment."status" = 'CONFIRMED') AS latest_paid_at
    FROM "factory_purchase_order_payments" payment
    WHERE payment."purchase_order_id" = settlement."purchase_order_id"
  ) payment_totals
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS active_count,
           MIN(cost."amount") AS amount,
           MIN(cost."amount_cny") AS amount_cny,
           MIN(cost."payment_status") AS payment_status,
           BOOL_AND(cost."paid") AS paid,
           MIN(cost."payment_date"::DATE) AS payment_date,
           MIN(cost."paid_at"::DATE) AS paid_at
    FROM "order_costs" cost
    WHERE cost."source_type" = 'FACTORY_PURCHASE_SETTLEMENT'
      AND cost."source_id" = settlement."purchase_order_id"
      AND cost."status" = 'ACTIVE'
      AND cost."deleted_at" IS NULL
  ) settlement_cost ON TRUE
  WHERE settlement."increase_amount" IS DISTINCT FROM adjustment_totals.increase_amount
    OR settlement."decrease_amount" IS DISTINCT FROM adjustment_totals.decrease_amount
    OR settlement."final_payable_amount" IS DISTINCT FROM ROUND(
      settlement."base_amount" + adjustment_totals.increase_amount
        - adjustment_totals.decrease_amount - settlement."delay_penalty_amount", 2
    )
    OR payment_totals.net_paid < 0
    OR settlement."paid_amount_at_settlement" IS DISTINCT FROM payment_totals.net_paid
    OR settlement."status"::TEXT IS DISTINCT FROM CASE
      WHEN payment_totals.net_paid < settlement."final_payable_amount" THEN 'PENDING_PAYMENT'
      WHEN payment_totals.net_paid = settlement."final_payable_amount" THEN 'SETTLED'
      ELSE 'PENDING_REFUND'
    END
    OR settlement_cost.active_count <> 1
    OR settlement_cost.amount IS DISTINCT FROM settlement."final_payable_amount"
    OR settlement_cost.amount_cny IS DISTINCT FROM ROUND(
      settlement."final_payable_amount" * settlement."exchange_rate", 2
    )
    OR settlement_cost.payment_status IS DISTINCT FROM CASE
      WHEN payment_totals.net_paid > settlement."final_payable_amount" THEN '待退款'
      WHEN payment_totals.net_paid = settlement."final_payable_amount" THEN '已支付'
      WHEN payment_totals.net_paid > 0 THEN '部分支付'
      ELSE '待支付'
    END
    OR settlement_cost.paid IS DISTINCT FROM (
      payment_totals.net_paid > 0 OR payment_totals.net_paid = settlement."final_payable_amount"
    )
    OR settlement_cost.payment_date IS DISTINCT FROM CASE
      WHEN payment_totals.net_paid > 0 THEN payment_totals.latest_paid_at
      WHEN settlement."final_payable_amount" = 0 THEN (
        SELECT purchase_order."actual_delivery_date"
        FROM "factory_purchase_orders" purchase_order
        WHERE purchase_order."id" = settlement."purchase_order_id"
      )
      ELSE NULL
    END
    OR settlement_cost.paid_at IS DISTINCT FROM CASE
      WHEN payment_totals.net_paid > 0 THEN payment_totals.latest_paid_at
      WHEN settlement."final_payable_amount" = 0 THEN (
        SELECT purchase_order."actual_delivery_date"
        FROM "factory_purchase_orders" purchase_order
        WHERE purchase_order."id" = settlement."purchase_order_id"
      )
      ELSE NULL
    END
  LIMIT 1;

  IF inconsistent_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'factory settlement legacy ledger preflight failed',
      DETAIL = 'purchase_order_id=' || inconsistent_purchase_order_id,
      HINT = 'Reconcile settlement, confirmed payments and the active settlement cost before retrying this migration.';
  END IF;

  SELECT adjustment."purchase_order_id"
  INTO inconsistent_purchase_order_id
  FROM "factory_purchase_order_adjustments" adjustment
  LEFT JOIN "factory_purchase_order_price_corrections" price_correction
    ON price_correction."id" = adjustment."source_id"
  WHERE adjustment."source_type" = 'PURCHASE_PRICE_CORRECTION'
    AND adjustment."status" = 'CONFIRMED'
    AND (
      price_correction."id" IS NULL
      OR price_correction."status" <> 'APPROVED'
      OR price_correction."purchase_order_id" IS DISTINCT FROM adjustment."purchase_order_id"
      OR price_correction."adjustment_id" IS DISTINCT FROM adjustment."id"
    )
  LIMIT 1;
  IF inconsistent_purchase_order_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'factory price correction adjustment preflight failed',
      DETAIL = 'purchase_order_id=' || inconsistent_purchase_order_id,
      HINT = 'Repair the correction approval and adjustment backlink before retrying this migration.';
  END IF;
END;
$$;

ALTER TABLE "factory_purchase_order_settlements"
  DROP CONSTRAINT "factory_purchase_order_settlements_amount_check",
  DROP CONSTRAINT "factory_purchase_order_settlements_state_check",
  ADD CONSTRAINT "factory_purchase_order_settlements_amount_check" CHECK (
    "base_amount" >= 0
    AND "increase_amount" >= 0
    AND "decrease_amount" >= 0
    AND "delay_days" >= 0
    AND "delay_penalty_amount" >= 0
    AND "final_payable_amount" >= 0
    AND "exchange_rate" > 0
    AND "paid_amount_at_settlement" >= 0
    AND "revision" > 0
  ),
  ADD CONSTRAINT "factory_purchase_order_settlements_state_check" CHECK (
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
    ) OR (
      "status" = 'PENDING_REFUND'
      AND "settled_at" IS NULL
      AND "settled_by" IS NULL
      AND "paid_amount_at_settlement" > "final_payable_amount"
    )
  );

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD CONSTRAINT "fpo_price_corrections_settlement_snapshot_check" CHECK (
    (
      "settlement_final_payable_before" IS NULL
      AND "settlement_final_payable_after" IS NULL
      AND "settlement_status_before" IS NULL
      AND "settlement_status_after" IS NULL
      AND "settlement_revision_before" IS NULL
      AND "settlement_revision_after" IS NULL
      AND "settlement_increase_before" IS NULL
      AND "settlement_increase_after" IS NULL
      AND "settlement_decrease_before" IS NULL
      AND "settlement_decrease_after" IS NULL
      AND "settlement_paid_before" IS NULL
      AND "settlement_paid_after" IS NULL
      AND "settlement_settled_at_before" IS NULL
      AND "settlement_settled_at_after" IS NULL
      AND "settlement_settled_by_before" IS NULL
      AND "settlement_settled_by_after" IS NULL
    ) OR (
      "settlement_final_payable_before" IS NOT NULL
      AND "settlement_final_payable_after" IS NOT NULL
      AND "settlement_status_before" IS NOT NULL
      AND "settlement_status_after" IS NOT NULL
      AND "settlement_revision_before" IS NOT NULL
      AND "settlement_revision_after" IS NOT NULL
      AND "settlement_increase_before" IS NOT NULL
      AND "settlement_increase_after" IS NOT NULL
      AND "settlement_decrease_before" IS NOT NULL
      AND "settlement_decrease_after" IS NOT NULL
      AND "settlement_paid_before" IS NOT NULL
      AND "settlement_paid_after" IS NOT NULL
      AND "settlement_final_payable_before" >= 0
      AND "settlement_final_payable_after" >= 0
      AND "settlement_revision_before" > 0
      AND "settlement_revision_after" = "settlement_revision_before" + 1
      AND "settlement_increase_before" >= 0
      AND "settlement_increase_after" >= 0
      AND "settlement_decrease_before" >= 0
      AND "settlement_decrease_after" >= 0
      AND "settlement_paid_before" >= 0
      AND "settlement_paid_after" >= 0
      AND (
        ("settlement_status_before" = 'SETTLED'
          AND "settlement_settled_at_before" IS NOT NULL
          AND "settlement_settled_by_before" IS NOT NULL)
        OR ("settlement_status_before" <> 'SETTLED'
          AND "settlement_settled_at_before" IS NULL
          AND "settlement_settled_by_before" IS NULL)
      )
      AND (
        ("settlement_status_after" = 'SETTLED'
          AND "settlement_settled_at_after" IS NOT NULL
          AND "settlement_settled_by_after" IS NOT NULL)
        OR ("settlement_status_after" <> 'SETTLED'
          AND "settlement_settled_at_after" IS NULL
          AND "settlement_settled_by_after" IS NULL)
      )
    )
  ),
  ADD CONSTRAINT "fpo_price_corrections_effective_change_check" CHECK (
    "new_unit_price" > 0
    AND "delta_amount" <> 0
  ),
  ADD CONSTRAINT "fpo_price_corrections_review_state_check" CHECK (
    (
      "status" = 'PENDING'
      AND "adjustment_id" IS NULL
      AND "reviewed_by" IS NULL
      AND "reviewed_at" IS NULL
      AND "settlement_final_payable_before" IS NULL
      AND "settlement_final_payable_after" IS NULL
      AND "settlement_status_before" IS NULL
      AND "settlement_status_after" IS NULL
    ) OR (
      "status" = 'REJECTED'
      AND "adjustment_id" IS NULL
      AND "reviewed_by" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
      AND "settlement_final_payable_before" IS NULL
      AND "settlement_final_payable_after" IS NULL
      AND "settlement_status_before" IS NULL
      AND "settlement_status_after" IS NULL
    ) OR (
      "status" = 'APPROVED'
      AND "adjustment_id" IS NOT NULL
      AND "reviewed_by" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "fpo_price_corrections_settlement_revision_key"
  ON "factory_purchase_order_price_corrections" ("purchase_order_id", "settlement_revision_after")
  WHERE "settlement_revision_after" IS NOT NULL;

-- One definition is shared by settlement, cost and deferred-commit guards.
-- Only confirmed PREPAYMENT/BALANCE rows add value; confirmed REFUND rows
-- subtract value. Voided evidence never affects the net amount.
CREATE OR REPLACE FUNCTION "factory_purchase_order_net_paid"(target_purchase_order_id TEXT)
RETURNS NUMERIC(18,2) AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN payment."status" <> 'CONFIRMED' THEN 0
      WHEN payment."kind" = 'REFUND' THEN -payment."amount"
      ELSE payment."amount"
    END
  ), 0)::NUMERIC(18,2)
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = target_purchase_order_id;
$$ LANGUAGE sql VOLATILE;

-- Keep ordinary adjustments and ordinary post-close payments frozen. The only
-- post-settlement adjustment exception is a confirmed row generated from the
-- matching pending price-correction request. Refunds are accepted only while
-- a settlement is explicitly waiting for a refund and may not over-refund.
CREATE OR REPLACE FUNCTION "guard_factory_purchase_ledger_after_settlement"()
RETURNS trigger AS $$
DECLARE
  settlement_status "FactoryPurchaseSettlementStatus";
  settlement_final NUMERIC(18,2);
  current_net_paid NUMERIC(18,2);
  target_purchase_order_id TEXT;
  correction RECORD;
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

  IF NOT FOUND THEN
    IF TG_TABLE_NAME = 'factory_purchase_order_payments' AND TG_OP = 'INSERT' THEN
      IF NEW."kind" = 'REFUND' THEN
        RAISE EXCEPTION 'factory purchase refund requires an existing settlement waiting for refund';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'factory_purchase_order_adjustments' THEN
    IF TG_OP <> 'INSERT'
      OR NEW."source_type" IS DISTINCT FROM 'PURCHASE_PRICE_CORRECTION'
      OR NEW."source_id" IS NULL
      OR NEW."kind" <> 'OTHER'
      OR NEW."status" <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'factory purchase order adjustments are frozen after final settlement';
    END IF;

    SELECT price_correction."purchase_order_id", price_correction."status",
           price_correction."currency", price_correction."delta_amount"
    INTO correction
    FROM "factory_purchase_order_price_corrections" price_correction
    WHERE price_correction."id" = NEW."source_id"
    FOR UPDATE;

    IF NOT FOUND
      OR correction."purchase_order_id" IS DISTINCT FROM NEW."purchase_order_id"
      OR correction."status" <> 'PENDING'
      OR correction."currency" IS DISTINCT FROM NEW."currency"
      OR NEW."amount" IS DISTINCT FROM ABS(correction."delta_amount")
      OR NEW."direction"::TEXT IS DISTINCT FROM (
        CASE WHEN correction."delta_amount" > 0 THEN 'INCREASE' ELSE 'DECREASE' END
      ) THEN
      RAISE EXCEPTION 'post-settlement adjustment must match one pending purchase price correction';
    END IF;
    RETURN NEW;
  END IF;

  current_net_paid := "factory_purchase_order_net_paid"(target_purchase_order_id);

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'post-settlement purchase payment must be confirmed';
    END IF;
    IF NEW."kind" = 'BALANCE'
      AND settlement_status = 'PENDING_PAYMENT'
      AND current_net_paid + NEW."amount" <= settlement_final THEN
      RETURN NEW;
    END IF;
    IF NEW."kind" = 'REFUND'
      AND settlement_status = 'PENDING_REFUND'
      AND current_net_paid - NEW."amount" >= settlement_final THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'payment kind or amount does not match the pending settlement action';
  END IF;

  IF NEW."status" = 'VOIDED'
    AND settlement_status <> 'SETTLED'
    AND OLD."kind" IN ('BALANCE', 'REFUND') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'closed factory purchase payment evidence cannot be changed';
END;
$$ LANGUAGE plpgsql;

-- Settlement principal remains immutable. A price correction may advance the
-- financial revision exactly once, and its new totals must be a complete
-- reconstruction of the confirmed adjustment ledger. Payment/refund changes
-- may only synchronize status and the net-paid snapshot.
CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_settlement"()
RETURNS trigger AS $$
DECLARE
  net_paid NUMERIC(18,2);
  expected_increase NUMERIC(18,2);
  expected_decrease NUMERIC(18,2);
  expected_final NUMERIC(18,2);
  expected_status "FactoryPurchaseSettlementStatus";
  financial_changed BOOLEAN;
  matching_correction_count INTEGER;
  pending_correction_adjustment_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase settlements cannot be deleted';
  END IF;

  IF NEW."purchase_order_id" IS DISTINCT FROM OLD."purchase_order_id"
    OR NEW."base_amount" IS DISTINCT FROM OLD."base_amount"
    OR NEW."delay_days" IS DISTINCT FROM OLD."delay_days"
    OR NEW."delay_penalty_amount" IS DISTINCT FROM OLD."delay_penalty_amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."exchange_rate" IS DISTINCT FROM OLD."exchange_rate"
    OR NEW."exchange_rate_date" IS DISTINCT FROM OLD."exchange_rate_date"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'factory purchase settlement financial snapshot is immutable';
  END IF;
  IF OLD."status" = 'SETTLED' AND NEW."status" = 'SETTLED' AND (
    NEW."settled_at" IS DISTINCT FROM OLD."settled_at"
    OR NEW."settled_by" IS DISTINCT FROM OLD."settled_by"
  ) THEN
    RAISE EXCEPTION 'closed factory settlement audit fields are immutable';
  END IF;

  PERFORM purchase_order."id"
  FROM "factory_purchase_orders" purchase_order
  WHERE purchase_order."id" = NEW."purchase_order_id"
  FOR UPDATE;
  PERFORM payment."id"
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY payment."sequence_no", payment."id"
  FOR UPDATE;
  PERFORM adjustment."id"
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY adjustment."sequence_no", adjustment."id"
  FOR UPDATE;

  SELECT
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'INCREASE'
    ), 0)::NUMERIC(18,2),
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'DECREASE'
    ), 0)::NUMERIC(18,2)
  INTO expected_increase, expected_decrease
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."purchase_order_id" = NEW."purchase_order_id";

  expected_final := ROUND(
    NEW."base_amount" + expected_increase - expected_decrease - NEW."delay_penalty_amount",
    2
  )::NUMERIC(18,2);
  IF expected_final < 0
    OR NEW."increase_amount" IS DISTINCT FROM expected_increase
    OR NEW."decrease_amount" IS DISTINCT FROM expected_decrease
    OR NEW."final_payable_amount" IS DISTINCT FROM expected_final THEN
    RAISE EXCEPTION 'factory settlement revision does not match the confirmed adjustment ledger';
  END IF;

  financial_changed := NEW."increase_amount" IS DISTINCT FROM OLD."increase_amount"
    OR NEW."decrease_amount" IS DISTINCT FROM OLD."decrease_amount"
    OR NEW."final_payable_amount" IS DISTINCT FROM OLD."final_payable_amount";

  IF financial_changed THEN
    IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
      RAISE EXCEPTION 'factory settlement price correction must advance revision exactly once';
    END IF;
    SELECT COUNT(*) FILTER (WHERE
        (NEW."final_payable_amount" > OLD."final_payable_amount"
          AND adjustment."direction" = 'INCREASE'
          AND adjustment."amount" = NEW."final_payable_amount" - OLD."final_payable_amount")
        OR
        (NEW."final_payable_amount" < OLD."final_payable_amount"
          AND adjustment."direction" = 'DECREASE'
          AND adjustment."amount" = OLD."final_payable_amount" - NEW."final_payable_amount")
      )::INTEGER,
      COUNT(*)::INTEGER
    INTO matching_correction_count, pending_correction_adjustment_count
    FROM "factory_purchase_order_adjustments" adjustment
    JOIN "factory_purchase_order_price_corrections" price_correction
      ON price_correction."id" = adjustment."source_id"
     AND price_correction."purchase_order_id" = adjustment."purchase_order_id"
    WHERE adjustment."purchase_order_id" = NEW."purchase_order_id"
      AND adjustment."source_type" = 'PURCHASE_PRICE_CORRECTION'
      AND adjustment."status" = 'CONFIRMED'
      AND price_correction."status" = 'PENDING';
    IF matching_correction_count <> 1 OR pending_correction_adjustment_count <> 1 THEN
      RAISE EXCEPTION 'settlement financial revision requires one matching purchase price correction';
    END IF;
  ELSIF NEW."revision" IS DISTINCT FROM OLD."revision" THEN
    RAISE EXCEPTION 'factory settlement revision may only change with a price correction';
  END IF;

  net_paid := "factory_purchase_order_net_paid"(NEW."purchase_order_id");
  expected_status := CASE
    WHEN net_paid < NEW."final_payable_amount" THEN 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    WHEN net_paid = NEW."final_payable_amount" THEN 'SETTLED'::"FactoryPurchaseSettlementStatus"
    ELSE 'PENDING_REFUND'::"FactoryPurchaseSettlementStatus"
  END;

  IF NEW."paid_amount_at_settlement" IS DISTINCT FROM net_paid
    OR NEW."status" IS DISTINCT FROM expected_status THEN
    RAISE EXCEPTION 'factory settlement status must follow net confirmed payments';
  END IF;
  IF expected_status = 'SETTLED' AND (
    NEW."settled_at" IS NULL OR NEW."settled_by" IS NULL
  ) THEN
    RAISE EXCEPTION 'fully paid factory settlement requires settlement audit fields';
  END IF;
  IF expected_status <> 'SETTLED' AND (
    NEW."settled_at" IS NOT NULL OR NEW."settled_by" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'pending payment or refund settlement cannot remain closed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Cost rows continue to be derived records. They may follow a guarded
-- settlement revision, but no independent cost-field rewrite is accepted.
CREATE OR REPLACE FUNCTION "protect_factory_settlement_order_cost"()
RETURNS trigger AS $$
DECLARE
  settlement_record RECORD;
  net_paid NUMERIC(18,2);
  latest_payment_date DATE;
  expected_payment_status TEXT;
  expected_paid BOOLEAN;
  expected_payment_date DATE;
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

  SELECT settlement."final_payable_amount", settlement."exchange_rate",
         settlement."exchange_rate_date", settlement."created_by",
         settlement."revision", purchase_order."supplier_id",
         purchase_order."supplier_name_snapshot", purchase_order."actual_delivery_date",
         purchase_order."purchase_currency", purchase_order."po_no",
         receivable_order."id" AS "receivable_order_id"
  INTO settlement_record
  FROM "factory_purchase_order_settlements" settlement
  JOIN "factory_purchase_orders" purchase_order
    ON purchase_order."id" = settlement."purchase_order_id"
  JOIN "sales_executions" execution
    ON execution."id" = purchase_order."execution_id"
  JOIN "receivable_orders" receivable_order
    ON receivable_order."source_sales_execution_id" = execution."id"
   AND receivable_order."deleted_at" IS NULL
  WHERE settlement."purchase_order_id" = NEW."source_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserved factory settlement cost source requires an existing settlement';
  END IF;

  net_paid := "factory_purchase_order_net_paid"(NEW."source_id");
  SELECT MAX(payment."paid_at")
  INTO latest_payment_date
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = NEW."source_id"
    AND payment."status" = 'CONFIRMED';

  expected_payment_status := CASE
    WHEN net_paid > settlement_record."final_payable_amount" THEN '待退款'
    WHEN net_paid = settlement_record."final_payable_amount" THEN '已支付'
    WHEN net_paid > 0 THEN '部分支付'
    ELSE '待支付'
  END;
  expected_paid := net_paid > 0 OR net_paid = settlement_record."final_payable_amount";
  expected_payment_date := CASE
    WHEN net_paid > 0 THEN latest_payment_date
    WHEN settlement_record."final_payable_amount" = 0 THEN settlement_record."actual_delivery_date"
    ELSE NULL
  END;

  IF NEW."order_id" IS DISTINCT FROM settlement_record."receivable_order_id"
    OR NEW."supplier_id" IS DISTINCT FROM settlement_record."supplier_id"
    OR NEW."supplier_name_snapshot" IS DISTINCT FROM settlement_record."supplier_name_snapshot"
    OR NEW."cost_type" <> '工厂货款'
    OR NEW."vendor_name" IS DISTINCT FROM settlement_record."supplier_name_snapshot"
    OR NEW."currency" IS DISTINCT FROM settlement_record."purchase_currency"
    OR NEW."exchange_rate" IS DISTINCT FROM settlement_record."exchange_rate"
    OR NEW."exchange_rate_date" IS DISTINCT FROM settlement_record."exchange_rate_date"
    OR NEW."amount" IS DISTINCT FROM settlement_record."final_payable_amount"
    OR NEW."amount_cny" IS DISTINCT FROM ROUND(
      settlement_record."final_payable_amount" * settlement_record."exchange_rate", 2
    )
    OR NEW."cost_confirmed" IS NOT TRUE
    OR NEW."cost_confirmed_at" IS NULL
    OR NEW."source_id" IS NULL
    OR NEW."status" <> 'ACTIVE'
    OR NEW."deleted_at" IS NOT NULL
    OR NEW."created_by" IS DISTINCT FROM settlement_record."created_by"
    OR NEW."remark" IS DISTINCT FROM (
      '由工厂采购单 ' || settlement_record."po_no" || ' 最终结算自动生成'
    ) THEN
    RAISE EXCEPTION 'factory settlement cost does not match its settlement snapshot';
  END IF;

  IF NEW."payment_status" IS DISTINCT FROM expected_payment_status
    OR NEW."paid" IS DISTINCT FROM expected_paid
    OR NEW."payment_date"::DATE IS DISTINCT FROM expected_payment_date
    OR NEW."paid_at"::DATE IS DISTINCT FROM expected_payment_date THEN
    RAISE EXCEPTION 'factory settlement cost payment state must follow the net purchase payment ledger';
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
    RAISE EXCEPTION 'factory settlement cost principal fields are immutable';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (
      NEW."amount" IS DISTINCT FROM OLD."amount"
      OR NEW."amount_cny" IS DISTINCT FROM OLD."amount_cny"
    )
    AND (
      settlement_record."revision" <= 1
      OR OLD."amount" IS NOT DISTINCT FROM settlement_record."final_payable_amount"
    ) THEN
    RAISE EXCEPTION 'factory settlement cost amount may only follow a new settlement revision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Review-time snapshots are part of the immutable correction record. When a
-- settlement exists, approval must record both sides and the signed delta must
-- explain the revised payable amount and both derived statuses.
CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_price_correction"()
RETURNS trigger AS $$
DECLARE
  settlement_record RECORD;
  net_paid NUMERIC(18,2);
  expected_before_status "FactoryPurchaseSettlementStatus";
  expected_after_status "FactoryPurchaseSettlementStatus";
  snapshots_complete BOOLEAN;
  snapshots_present BOOLEAN;
  adjustment_record RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase price correction records cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING'
      OR NEW."review_remark" IS NOT NULL
      OR NEW."adjustment_id" IS NOT NULL
      OR NEW."settlement_final_payable_before" IS NOT NULL
      OR NEW."settlement_final_payable_after" IS NOT NULL
      OR NEW."settlement_status_before" IS NOT NULL
      OR NEW."settlement_status_after" IS NOT NULL
      OR NEW."settlement_revision_before" IS NOT NULL
      OR NEW."settlement_revision_after" IS NOT NULL
      OR NEW."settlement_increase_before" IS NOT NULL
      OR NEW."settlement_increase_after" IS NOT NULL
      OR NEW."settlement_decrease_before" IS NOT NULL
      OR NEW."settlement_decrease_after" IS NOT NULL
      OR NEW."settlement_paid_before" IS NOT NULL
      OR NEW."settlement_paid_after" IS NOT NULL
      OR NEW."settlement_settled_at_before" IS NOT NULL
      OR NEW."settlement_settled_at_after" IS NOT NULL
      OR NEW."settlement_settled_by_before" IS NOT NULL
      OR NEW."settlement_settled_by_after" IS NOT NULL
      OR NEW."reviewed_by" IS NOT NULL
      OR NEW."reviewed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'new factory purchase price correction must start pending and unreviewed';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'reviewed factory purchase price correction records are immutable';
  END IF;

  IF (
    TO_JSONB(NEW)
      - 'status' - 'review_remark' - 'adjustment_id'
      - 'settlement_final_payable_before' - 'settlement_final_payable_after'
      - 'settlement_status_before' - 'settlement_status_after'
      - 'settlement_revision_before' - 'settlement_revision_after'
      - 'settlement_increase_before' - 'settlement_increase_after'
      - 'settlement_decrease_before' - 'settlement_decrease_after'
      - 'settlement_paid_before' - 'settlement_paid_after'
      - 'settlement_settled_at_before' - 'settlement_settled_at_after'
      - 'settlement_settled_by_before' - 'settlement_settled_by_after'
      - 'reviewed_by' - 'reviewed_at' - 'updated_at'
  ) IS DISTINCT FROM (
    TO_JSONB(OLD)
      - 'status' - 'review_remark' - 'adjustment_id'
      - 'settlement_final_payable_before' - 'settlement_final_payable_after'
      - 'settlement_status_before' - 'settlement_status_after'
      - 'settlement_revision_before' - 'settlement_revision_after'
      - 'settlement_increase_before' - 'settlement_increase_after'
      - 'settlement_decrease_before' - 'settlement_decrease_after'
      - 'settlement_paid_before' - 'settlement_paid_after'
      - 'settlement_settled_at_before' - 'settlement_settled_at_after'
      - 'settlement_settled_by_before' - 'settlement_settled_by_after'
      - 'reviewed_by' - 'reviewed_at' - 'updated_at'
  ) THEN
    RAISE EXCEPTION 'factory purchase price correction request content is immutable after submission';
  END IF;

  IF NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION 'factory purchase price correction update must review the request';
  END IF;
  IF NEW."reviewed_by" IS NULL OR NEW."reviewed_at" IS NULL THEN
    RAISE EXCEPTION 'factory purchase price correction review requires reviewer and review time';
  END IF;

  snapshots_complete := NEW."settlement_final_payable_before" IS NOT NULL
    AND NEW."settlement_final_payable_after" IS NOT NULL
    AND NEW."settlement_status_before" IS NOT NULL
    AND NEW."settlement_status_after" IS NOT NULL
    AND NEW."settlement_revision_before" IS NOT NULL
    AND NEW."settlement_revision_after" IS NOT NULL
    AND NEW."settlement_increase_before" IS NOT NULL
    AND NEW."settlement_increase_after" IS NOT NULL
    AND NEW."settlement_decrease_before" IS NOT NULL
    AND NEW."settlement_decrease_after" IS NOT NULL
    AND NEW."settlement_paid_before" IS NOT NULL
    AND NEW."settlement_paid_after" IS NOT NULL
    AND ((NEW."settlement_status_before" = 'SETTLED'
        AND NEW."settlement_settled_at_before" IS NOT NULL
        AND NEW."settlement_settled_by_before" IS NOT NULL)
      OR (NEW."settlement_status_before" <> 'SETTLED'
        AND NEW."settlement_settled_at_before" IS NULL
        AND NEW."settlement_settled_by_before" IS NULL))
    AND ((NEW."settlement_status_after" = 'SETTLED'
        AND NEW."settlement_settled_at_after" IS NOT NULL
        AND NEW."settlement_settled_by_after" IS NOT NULL)
      OR (NEW."settlement_status_after" <> 'SETTLED'
        AND NEW."settlement_settled_at_after" IS NULL
        AND NEW."settlement_settled_by_after" IS NULL));
  snapshots_present := NEW."settlement_final_payable_before" IS NOT NULL
    OR NEW."settlement_final_payable_after" IS NOT NULL
    OR NEW."settlement_status_before" IS NOT NULL
    OR NEW."settlement_status_after" IS NOT NULL
    OR NEW."settlement_revision_before" IS NOT NULL
    OR NEW."settlement_revision_after" IS NOT NULL
    OR NEW."settlement_increase_before" IS NOT NULL
    OR NEW."settlement_increase_after" IS NOT NULL
    OR NEW."settlement_decrease_before" IS NOT NULL
    OR NEW."settlement_decrease_after" IS NOT NULL
    OR NEW."settlement_paid_before" IS NOT NULL
    OR NEW."settlement_paid_after" IS NOT NULL
    OR NEW."settlement_settled_at_before" IS NOT NULL
    OR NEW."settlement_settled_at_after" IS NOT NULL
    OR NEW."settlement_settled_by_before" IS NOT NULL
    OR NEW."settlement_settled_by_after" IS NOT NULL;

  IF NEW."status" = 'REJECTED' THEN
    IF NEW."adjustment_id" IS NOT NULL OR snapshots_present THEN
      RAISE EXCEPTION 'rejected factory purchase price correction cannot carry settlement effects';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."adjustment_id" IS NULL THEN
    RAISE EXCEPTION 'approved factory purchase price correction requires an adjustment row';
  END IF;

  SELECT adjustment."purchase_order_id", adjustment."source_type",
         adjustment."source_id", adjustment."kind", adjustment."direction",
         adjustment."amount", adjustment."currency", adjustment."status"
  INTO adjustment_record
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."id" = NEW."adjustment_id";
  IF NOT FOUND
    OR adjustment_record."purchase_order_id" IS DISTINCT FROM NEW."purchase_order_id"
    OR adjustment_record."source_type" IS DISTINCT FROM 'PURCHASE_PRICE_CORRECTION'
    OR adjustment_record."source_id" IS DISTINCT FROM NEW."id"
    OR adjustment_record."kind" <> 'OTHER'
    OR adjustment_record."status" <> 'CONFIRMED'
    OR adjustment_record."currency" IS DISTINCT FROM NEW."currency"
    OR adjustment_record."amount" IS DISTINCT FROM ABS(NEW."delta_amount")
    OR adjustment_record."direction"::TEXT IS DISTINCT FROM (
      CASE WHEN NEW."delta_amount" > 0 THEN 'INCREASE' ELSE 'DECREASE' END
    ) THEN
    RAISE EXCEPTION 'approved purchase price correction adjustment does not match its request';
  END IF;

  SELECT settlement."final_payable_amount", settlement."status",
         settlement."revision", settlement."increase_amount",
         settlement."decrease_amount", settlement."paid_amount_at_settlement",
         settlement."settled_at", settlement."settled_by"
  INTO settlement_record
  FROM "factory_purchase_order_settlements" settlement
  WHERE settlement."purchase_order_id" = NEW."purchase_order_id";

  IF NOT FOUND THEN
    IF snapshots_present THEN
      RAISE EXCEPTION 'pre-settlement price correction cannot carry settlement snapshots';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT snapshots_complete THEN
    RAISE EXCEPTION 'post-settlement price correction requires before and after settlement snapshots';
  END IF;

  net_paid := "factory_purchase_order_net_paid"(NEW."purchase_order_id");
  expected_before_status := CASE
    WHEN net_paid < NEW."settlement_final_payable_before" THEN 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    WHEN net_paid = NEW."settlement_final_payable_before" THEN 'SETTLED'::"FactoryPurchaseSettlementStatus"
    ELSE 'PENDING_REFUND'::"FactoryPurchaseSettlementStatus"
  END;
  expected_after_status := CASE
    WHEN net_paid < NEW."settlement_final_payable_after" THEN 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    WHEN net_paid = NEW."settlement_final_payable_after" THEN 'SETTLED'::"FactoryPurchaseSettlementStatus"
    ELSE 'PENDING_REFUND'::"FactoryPurchaseSettlementStatus"
  END;

  IF NEW."settlement_final_payable_after" IS DISTINCT FROM settlement_record."final_payable_amount"
    OR NEW."settlement_status_after" IS DISTINCT FROM settlement_record."status"
    OR NEW."settlement_revision_after" IS DISTINCT FROM settlement_record."revision"
    OR NEW."settlement_revision_after" IS DISTINCT FROM NEW."settlement_revision_before" + 1
    OR NEW."settlement_increase_after" IS DISTINCT FROM settlement_record."increase_amount"
    OR NEW."settlement_decrease_after" IS DISTINCT FROM settlement_record."decrease_amount"
    OR NEW."settlement_paid_before" IS DISTINCT FROM net_paid
    OR NEW."settlement_paid_after" IS DISTINCT FROM net_paid
    OR NEW."settlement_settled_at_after" IS DISTINCT FROM settlement_record."settled_at"
    OR NEW."settlement_settled_by_after" IS DISTINCT FROM settlement_record."settled_by"
    OR NEW."settlement_status_before" IS DISTINCT FROM expected_before_status
    OR NEW."settlement_status_after" IS DISTINCT FROM expected_after_status
    OR NEW."settlement_final_payable_after" - NEW."settlement_final_payable_before"
       IS DISTINCT FROM NEW."delta_amount"
    OR (NEW."delta_amount" > 0 AND (
      NEW."settlement_increase_after" - NEW."settlement_increase_before" IS DISTINCT FROM NEW."delta_amount"
      OR NEW."settlement_decrease_after" IS DISTINCT FROM NEW."settlement_decrease_before"
    ))
    OR (NEW."delta_amount" < 0 AND (
      NEW."settlement_decrease_after" - NEW."settlement_decrease_before" IS DISTINCT FROM ABS(NEW."delta_amount")
      OR NEW."settlement_increase_after" IS DISTINCT FROM NEW."settlement_increase_before"
    )) THEN
    RAISE EXCEPTION 'purchase price correction settlement snapshots do not match the revised ledger';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "protect_factory_purchase_order_price_correction_trigger"
  ON "factory_purchase_order_price_corrections";
CREATE TRIGGER "protect_factory_purchase_order_price_correction_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "factory_purchase_order_price_corrections"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_price_correction"();

-- Reconcile the complete four-ledger state at COMMIT. This is deliberately
-- deferred so the service can create a correction adjustment and then update
-- settlement, cost and correction snapshots in one serializable transaction,
-- while any partial/manual write is rejected before commit.
CREATE OR REPLACE FUNCTION "assert_factory_purchase_settlement_commit_consistency"()
RETURNS trigger AS $$
DECLARE
  target_purchase_order_id TEXT;
  old_row JSONB;
  new_row JSONB;
  settlement_record RECORD;
  settlement_cost RECORD;
  linked_correction RECORD;
  expected_increase NUMERIC(18,2);
  expected_decrease NUMERIC(18,2);
  expected_final NUMERIC(18,2);
  net_paid NUMERIC(18,2);
  latest_payment_date DATE;
  expected_status "FactoryPurchaseSettlementStatus";
  expected_payment_status TEXT;
  expected_paid BOOLEAN;
  expected_payment_date DATE;
  minimum_running_paid NUMERIC(18,2);
  linked_correction_adjustment BOOLEAN := FALSE;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := TO_JSONB(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := TO_JSONB(NEW); END IF;

  target_purchase_order_id := CASE
    WHEN TG_TABLE_NAME IN (
      'factory_purchase_order_settlements',
      'factory_purchase_order_payments',
      'factory_purchase_order_adjustments'
    ) AND TG_OP = 'DELETE' THEN old_row ->> 'purchase_order_id'
    WHEN TG_TABLE_NAME IN (
      'factory_purchase_order_settlements',
      'factory_purchase_order_payments',
      'factory_purchase_order_adjustments'
    ) THEN new_row ->> 'purchase_order_id'
    WHEN TG_TABLE_NAME = 'factory_purchase_orders' AND TG_OP = 'DELETE'
      THEN old_row ->> 'id'
    WHEN TG_TABLE_NAME = 'factory_purchase_orders'
      THEN new_row ->> 'id'
    WHEN TG_TABLE_NAME = 'order_costs' AND TG_OP = 'DELETE'
      AND old_row ->> 'source_type' = 'FACTORY_PURCHASE_SETTLEMENT'
      THEN old_row ->> 'source_id'
    WHEN TG_TABLE_NAME = 'order_costs' AND TG_OP <> 'DELETE'
      AND new_row ->> 'source_type' = 'FACTORY_PURCHASE_SETTLEMENT'
      THEN new_row ->> 'source_id'
    WHEN TG_TABLE_NAME = 'order_costs' AND TG_OP = 'UPDATE'
      AND old_row ->> 'source_type' = 'FACTORY_PURCHASE_SETTLEMENT'
      THEN old_row ->> 'source_id'
    ELSE NULL
  END;
  IF target_purchase_order_id IS NULL THEN RETURN NULL; END IF;

  -- Validate the adjustment/request backlink before the settlement lookup so
  -- a pre-settlement direct SQL insert cannot escape through the early return.
  IF TG_TABLE_NAME = 'factory_purchase_order_adjustments'
    AND TG_OP = 'INSERT'
    AND new_row ->> 'source_type' = 'PURCHASE_PRICE_CORRECTION' THEN
    linked_correction_adjustment := TRUE;
    SELECT price_correction."status", price_correction."adjustment_id",
           price_correction."settlement_final_payable_before",
           price_correction."settlement_final_payable_after",
           price_correction."settlement_status_before",
           price_correction."settlement_status_after",
           price_correction."settlement_revision_before",
           price_correction."settlement_revision_after",
           price_correction."settlement_increase_before",
           price_correction."settlement_increase_after",
           price_correction."settlement_decrease_before",
           price_correction."settlement_decrease_after",
           price_correction."settlement_paid_before",
           price_correction."settlement_paid_after",
           price_correction."settlement_settled_at_before",
           price_correction."settlement_settled_at_after",
           price_correction."settlement_settled_by_before",
           price_correction."settlement_settled_by_after"
    INTO linked_correction
    FROM "factory_purchase_order_price_corrections" price_correction
    WHERE price_correction."id" = new_row ->> 'source_id';
    IF NOT FOUND
      OR linked_correction."status" <> 'APPROVED'
      OR linked_correction."adjustment_id" IS DISTINCT FROM new_row ->> 'id' THEN
      RAISE EXCEPTION 'purchase price correction adjustment must commit an approved backlink';
    END IF;
  END IF;

  SELECT settlement."status", settlement."base_amount",
         settlement."increase_amount", settlement."decrease_amount",
         settlement."delay_penalty_amount", settlement."final_payable_amount",
         settlement."paid_amount_at_settlement", settlement."exchange_rate",
         settlement."settled_at", settlement."settled_by", settlement."revision",
         purchase_order."status" AS purchase_order_status,
         purchase_order."actual_delivery_date"
  INTO settlement_record
  FROM "factory_purchase_order_settlements" settlement
  JOIN "factory_purchase_orders" purchase_order
    ON purchase_order."id" = settlement."purchase_order_id"
  WHERE settlement."purchase_order_id" = target_purchase_order_id;
  IF NOT FOUND THEN
    IF linked_correction_adjustment THEN
      IF linked_correction."settlement_final_payable_before" IS NOT NULL
        OR linked_correction."settlement_final_payable_after" IS NOT NULL
        OR linked_correction."settlement_status_before" IS NOT NULL
        OR linked_correction."settlement_status_after" IS NOT NULL
        OR linked_correction."settlement_revision_before" IS NOT NULL
        OR linked_correction."settlement_revision_after" IS NOT NULL
        OR linked_correction."settlement_increase_before" IS NOT NULL
        OR linked_correction."settlement_increase_after" IS NOT NULL
        OR linked_correction."settlement_decrease_before" IS NOT NULL
        OR linked_correction."settlement_decrease_after" IS NOT NULL
        OR linked_correction."settlement_paid_before" IS NOT NULL
        OR linked_correction."settlement_paid_after" IS NOT NULL
        OR linked_correction."settlement_settled_at_before" IS NOT NULL
        OR linked_correction."settlement_settled_at_after" IS NOT NULL
        OR linked_correction."settlement_settled_by_before" IS NOT NULL
        OR linked_correction."settlement_settled_by_after" IS NOT NULL THEN
        RAISE EXCEPTION 'pre-settlement price correction adjustment cannot carry settlement snapshots';
      END IF;
    END IF;
    RETURN NULL;
  END IF;
  IF linked_correction_adjustment THEN
    IF linked_correction."settlement_final_payable_before" IS NULL
      OR linked_correction."settlement_final_payable_after" IS NULL
      OR linked_correction."settlement_status_before" IS NULL
      OR linked_correction."settlement_status_after" IS NULL
      OR linked_correction."settlement_revision_before" IS NULL
      OR linked_correction."settlement_revision_after" IS NULL
      OR linked_correction."settlement_increase_before" IS NULL
      OR linked_correction."settlement_increase_after" IS NULL
      OR linked_correction."settlement_decrease_before" IS NULL
      OR linked_correction."settlement_decrease_after" IS NULL
      OR linked_correction."settlement_paid_before" IS NULL
      OR linked_correction."settlement_paid_after" IS NULL THEN
      RAISE EXCEPTION 'post-settlement price correction must commit its complete audit snapshots';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'factory_purchase_order_settlements'
    AND TG_OP = 'UPDATE'
    AND (
      new_row ->> 'increase_amount' IS DISTINCT FROM old_row ->> 'increase_amount'
      OR new_row ->> 'decrease_amount' IS DISTINCT FROM old_row ->> 'decrease_amount'
      OR new_row ->> 'final_payable_amount' IS DISTINCT FROM old_row ->> 'final_payable_amount'
    ) THEN
    SELECT price_correction.*
    INTO linked_correction
    FROM "factory_purchase_order_price_corrections" price_correction
    WHERE price_correction."purchase_order_id" = target_purchase_order_id
      AND price_correction."settlement_revision_after" = (new_row ->> 'revision')::INTEGER;
    IF NOT FOUND
      OR linked_correction."status" <> 'APPROVED'
      OR linked_correction."settlement_revision_before" IS DISTINCT FROM (old_row ->> 'revision')::INTEGER
      OR linked_correction."settlement_final_payable_before" IS DISTINCT FROM (old_row ->> 'final_payable_amount')::NUMERIC
      OR linked_correction."settlement_final_payable_after" IS DISTINCT FROM (new_row ->> 'final_payable_amount')::NUMERIC
      OR linked_correction."settlement_increase_before" IS DISTINCT FROM (old_row ->> 'increase_amount')::NUMERIC
      OR linked_correction."settlement_increase_after" IS DISTINCT FROM (new_row ->> 'increase_amount')::NUMERIC
      OR linked_correction."settlement_decrease_before" IS DISTINCT FROM (old_row ->> 'decrease_amount')::NUMERIC
      OR linked_correction."settlement_decrease_after" IS DISTINCT FROM (new_row ->> 'decrease_amount')::NUMERIC
      OR linked_correction."settlement_paid_before" IS DISTINCT FROM (old_row ->> 'paid_amount_at_settlement')::NUMERIC
      OR linked_correction."settlement_paid_after" IS DISTINCT FROM (new_row ->> 'paid_amount_at_settlement')::NUMERIC
      OR linked_correction."settlement_status_before"::TEXT IS DISTINCT FROM old_row ->> 'status'
      OR linked_correction."settlement_status_after"::TEXT IS DISTINCT FROM new_row ->> 'status'
      OR linked_correction."settlement_settled_at_before" IS DISTINCT FROM (old_row ->> 'settled_at')::TIMESTAMP
      OR linked_correction."settlement_settled_at_after" IS DISTINCT FROM (new_row ->> 'settled_at')::TIMESTAMP
      OR linked_correction."settlement_settled_by_before" IS DISTINCT FROM old_row ->> 'settled_by'
      OR linked_correction."settlement_settled_by_after" IS DISTINCT FROM new_row ->> 'settled_by' THEN
      RAISE EXCEPTION 'settlement financial revision requires an exact immutable correction snapshot';
    END IF;
  END IF;
  IF settlement_record.purchase_order_status <> 'ACCEPTED'::"FactoryPurchaseOrderStatus" THEN
    RAISE EXCEPTION 'factory settlement requires an accepted purchase order';
  END IF;

  SELECT
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'INCREASE'
    ), 0)::NUMERIC(18,2),
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'DECREASE'
    ), 0)::NUMERIC(18,2)
  INTO expected_increase, expected_decrease
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."purchase_order_id" = target_purchase_order_id;

  expected_final := ROUND(
    settlement_record.base_amount
      + expected_increase
      - expected_decrease
      - settlement_record.delay_penalty_amount,
    2
  )::NUMERIC(18,2);
  IF expected_final < 0
    OR settlement_record.increase_amount IS DISTINCT FROM expected_increase
    OR settlement_record.decrease_amount IS DISTINCT FROM expected_decrease
    OR settlement_record.final_payable_amount IS DISTINCT FROM expected_final THEN
    RAISE EXCEPTION 'factory settlement financial totals are out of sync with adjustments';
  END IF;

  net_paid := "factory_purchase_order_net_paid"(target_purchase_order_id);
  SELECT MIN(running_paid)
  INTO minimum_running_paid
  FROM (
    SELECT SUM(CASE
      WHEN payment."kind" = 'REFUND' THEN -payment."amount"
      ELSE payment."amount"
    END) OVER (
      ORDER BY payment."paid_at", payment."sequence_no", payment."id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::NUMERIC(18,2) AS running_paid
    FROM "factory_purchase_order_payments" payment
    WHERE payment."purchase_order_id" = target_purchase_order_id
      AND payment."status" = 'CONFIRMED'
  ) running_payment_ledger;
  IF COALESCE(minimum_running_paid, 0) < 0 THEN
    RAISE EXCEPTION 'factory purchase refund cannot precede or exceed confirmed payments by ledger date';
  END IF;
  SELECT MAX(payment."paid_at")
  INTO latest_payment_date
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = target_purchase_order_id
    AND payment."status" = 'CONFIRMED';
  expected_status := CASE
    WHEN net_paid < settlement_record.final_payable_amount
      THEN 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    WHEN net_paid = settlement_record.final_payable_amount
      THEN 'SETTLED'::"FactoryPurchaseSettlementStatus"
    ELSE 'PENDING_REFUND'::"FactoryPurchaseSettlementStatus"
  END;

  IF settlement_record.paid_amount_at_settlement IS DISTINCT FROM net_paid
    OR settlement_record.status IS DISTINCT FROM expected_status THEN
    RAISE EXCEPTION 'factory settlement status is out of sync with net confirmed payments';
  END IF;
  IF expected_status = 'SETTLED' AND (
    settlement_record.settled_at IS NULL OR settlement_record.settled_by IS NULL
  ) THEN
    RAISE EXCEPTION 'fully paid factory settlement must be closed in the same transaction';
  END IF;
  IF expected_status <> 'SETTLED' AND (
    settlement_record.settled_at IS NOT NULL OR settlement_record.settled_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'pending factory settlement must remain open';
  END IF;

  expected_payment_status := CASE
    WHEN net_paid > settlement_record.final_payable_amount THEN '待退款'
    WHEN net_paid = settlement_record.final_payable_amount THEN '已支付'
    WHEN net_paid > 0 THEN '部分支付'
    ELSE '待支付'
  END;
  expected_paid := net_paid > 0 OR net_paid = settlement_record.final_payable_amount;
  expected_payment_date := CASE
    WHEN net_paid > 0 THEN latest_payment_date
    WHEN settlement_record.final_payable_amount = 0
      THEN settlement_record.actual_delivery_date
    ELSE NULL
  END;

  SELECT cost."id", cost."amount", cost."amount_cny",
         cost."payment_status", cost."paid",
         cost."payment_date"::DATE AS payment_date,
         cost."paid_at"::DATE AS paid_at
  INTO settlement_cost
  FROM "order_costs" cost
  WHERE cost."source_type" = 'FACTORY_PURCHASE_SETTLEMENT'
    AND cost."source_id" = target_purchase_order_id
    AND cost."status" = 'ACTIVE'
    AND cost."deleted_at" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory settlement requires one active settlement cost';
  END IF;
  IF settlement_cost.amount IS DISTINCT FROM settlement_record.final_payable_amount
    OR settlement_cost.amount_cny IS DISTINCT FROM ROUND(
      settlement_record.final_payable_amount * settlement_record.exchange_rate, 2
    ) THEN
    RAISE EXCEPTION 'factory settlement cost amount is out of sync';
  END IF;
  IF settlement_cost.payment_status IS DISTINCT FROM expected_payment_status
    OR settlement_cost.paid IS DISTINCT FROM expected_paid
    OR settlement_cost.payment_date IS DISTINCT FROM expected_payment_date
    OR settlement_cost.paid_at IS DISTINCT FROM expected_payment_date THEN
    RAISE EXCEPTION 'factory settlement cost payment state is out of sync';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "factory_purchase_adjustments_commit_consistency"
  ON "factory_purchase_order_adjustments";
CREATE CONSTRAINT TRIGGER "factory_purchase_adjustments_commit_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "factory_purchase_order_adjustments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_factory_purchase_settlement_commit_consistency"();

COMMIT;
