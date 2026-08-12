BEGIN;

-- Keep the workflow stable while historical snapshots are reconstructed and
-- the new cross-table commit guards are installed.
LOCK TABLE "sales_executions",
           "receivable_orders",
           "factory_purchase_orders",
           "factory_purchase_order_payments",
           "factory_purchase_order_adjustments",
           "factory_purchase_order_settlements",
           "order_costs"
  IN SHARE ROW EXCLUSIVE MODE;

-- Rejected or voided orders retain their delivery audit but no longer have an
-- active dispatch email. CANCELLED is a durable workflow state, not a send
-- failure that should be retried.
ALTER TABLE "factory_purchase_orders"
  DROP CONSTRAINT "factory_purchase_orders_email_state_check",
  ADD CONSTRAINT "factory_purchase_orders_email_state_check" CHECK (
    "dispatch_email_status" IS NULL
    OR "dispatch_email_status" IN (
      'NOT_SENT', 'SENDING', 'SENT', 'FAILED', 'NO_RECIPIENT', 'CANCELLED'
    )
  );

-- Reconstruct every immutable settlement from its purchase terms and ledgers.
-- paid_amount_at_settlement is compared with the ledger as it existed when the
-- settlement was created, not with the current ledger after a valid void.
CREATE TEMP TABLE "_factory_settlement_integrity_audit" ON COMMIT DROP AS
SELECT
  settlement."id" AS settlement_id,
  purchase_order."id" AS purchase_order_id,
  CASE
    WHEN purchase_order."status" IS DISTINCT FROM 'ACCEPTED'::"FactoryPurchaseOrderStatus"
      THEN 'purchase order is not accepted'
    WHEN purchase_order."production_status" IS DISTINCT FROM 'COMPLETED'::"FactoryPurchaseOrderProductionStatus"
      OR purchase_order."production_completed_at" IS NULL
      THEN 'production is not completed'
    WHEN purchase_order."actual_delivery_date" IS NULL
      OR execution."shipping_started_at" IS NULL
      OR receivable_order."id" IS NULL
      THEN 'delivery or shipping anchor is missing'
    WHEN purchase_order."penalty_base_amount" IS NULL
      OR purchase_order."initial_supplier_delivery_date" IS NULL
      OR purchase_order."delay_grace_days" < 0
      OR purchase_order."delay_penalty_rate_per_day" < 0
      OR purchase_order."delay_penalty_cap_ratio" < 0
      THEN 'frozen purchase terms are incomplete'
    WHEN settlement."currency" IS DISTINCT FROM purchase_order."purchase_currency"
      OR settlement."base_amount" IS DISTINCT FROM purchase_order."penalty_base_amount"
      THEN 'currency or base amount does not match the purchase order'
    WHEN settlement."exchange_rate" <= 0
      OR (settlement."currency" = 'CNY' AND settlement."exchange_rate" <> 1)
      OR settlement."exchange_rate_date" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::DATE
      THEN 'exchange-rate evidence is invalid'
    WHEN adjustment_totals.provisional_count <> 0
      OR adjustment_totals.invalid_currency_count <> 0
      THEN 'adjustment ledger is not final or has a currency mismatch'
    WHEN settlement."increase_amount" IS DISTINCT FROM adjustment_totals.ordinary_increase
      OR settlement."decrease_amount" IS DISTINCT FROM adjustment_totals.ordinary_decrease
      THEN 'ordinary adjustment totals do not match the ledger'
    WHEN settlement."delay_days" IS DISTINCT FROM expected_amounts.delay_days
      OR settlement."delay_penalty_amount" IS DISTINCT FROM expected_amounts.delay_penalty
      THEN 'delay calculation does not match the frozen terms'
    WHEN expected_amounts.delay_penalty > 0 AND (
      adjustment_totals.delay_count <> 1
      OR adjustment_totals.invalid_delay_count <> 0
      OR adjustment_totals.delay_amount IS DISTINCT FROM expected_amounts.delay_penalty
    ) THEN 'delay deduction row does not match the calculated penalty'
    WHEN expected_amounts.delay_penalty = 0 AND adjustment_totals.delay_count <> 0
      THEN 'an unexpected delay deduction exists'
    WHEN expected_amounts.final_payable < 0
      OR settlement."final_payable_amount" IS DISTINCT FROM expected_amounts.final_payable
      THEN 'final payable amount does not match the purchase ledger'
    WHEN settlement."paid_amount_at_settlement" IS DISTINCT FROM historical_payments.confirmed_at_settlement
      THEN 'paid-at-settlement snapshot does not match the historical ledger'
    WHEN current_payments.confirmed_paid > settlement."final_payable_amount"
      THEN 'current confirmed payments exceed final payable'
    WHEN settlement."status" = 'SETTLED'::"FactoryPurchaseSettlementStatus" AND (
      current_payments.confirmed_paid IS DISTINCT FROM settlement."final_payable_amount"
      OR settlement."paid_amount_at_settlement" IS DISTINCT FROM settlement."final_payable_amount"
      OR settlement."settled_at" IS NULL
      OR settlement."settled_by" IS NULL
    ) THEN 'settled state does not match the payment ledger'
    WHEN settlement."status" = 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus" AND (
      current_payments.confirmed_paid >= settlement."final_payable_amount"
      OR settlement."settled_at" IS NOT NULL
      OR settlement."settled_by" IS NOT NULL
    ) THEN 'pending state does not match the payment ledger'
    WHEN settlement_cost."id" IS NULL
      THEN 'settlement cost is missing'
    WHEN settlement_cost."order_id" IS DISTINCT FROM receivable_order."id"
      OR settlement_cost."supplier_id" IS DISTINCT FROM purchase_order."supplier_id"
      OR settlement_cost."supplier_name_snapshot" IS DISTINCT FROM purchase_order."supplier_name_snapshot"
      OR settlement_cost."cost_type" <> '工厂货款'
      OR settlement_cost."vendor_name" IS DISTINCT FROM purchase_order."supplier_name_snapshot"
      OR settlement_cost."currency" IS DISTINCT FROM settlement."currency"
      OR settlement_cost."exchange_rate" IS DISTINCT FROM settlement."exchange_rate"
      OR settlement_cost."exchange_rate_date" IS DISTINCT FROM settlement."exchange_rate_date"
      OR settlement_cost."exchange_rate_source" IS DISTINCT FROM (
        CASE WHEN settlement."currency" = 'CNY' THEN '系统' ELSE '历史录入' END
      )
      OR settlement_cost."exchange_rate_type" IS DISTINCT FROM (
        CASE WHEN settlement."currency" = 'CNY' THEN '人民币' ELSE '采购结算' END
      )
      OR settlement_cost."amount" IS DISTINCT FROM settlement."final_payable_amount"
      OR settlement_cost."amount_cny" IS DISTINCT FROM ROUND(
        settlement."final_payable_amount" * settlement."exchange_rate",
        2
      )
      OR settlement_cost."cost_confirmed" IS NOT TRUE
      OR settlement_cost."cost_confirmed_at" IS NULL
      OR settlement_cost."status" <> 'ACTIVE'
      OR settlement_cost."deleted_at" IS NOT NULL
      OR settlement_cost."created_by" IS DISTINCT FROM settlement."created_by"
      OR settlement_cost."remark" IS DISTINCT FROM (
        '由工厂采购单 ' || purchase_order."po_no" || ' 最终结算自动生成'
      )
      THEN 'settlement cost financial snapshot does not match'
    WHEN settlement_cost."payment_status" IS DISTINCT FROM current_payments.expected_payment_status
      OR settlement_cost."paid" IS DISTINCT FROM current_payments.expected_paid
      OR settlement_cost."payment_date"::DATE IS DISTINCT FROM current_payments.expected_payment_date
      OR settlement_cost."paid_at"::DATE IS DISTINCT FROM current_payments.expected_payment_date
      THEN 'settlement cost payment state does not match the payment ledger'
    ELSE NULL
  END AS invalid_reason
FROM "factory_purchase_order_settlements" settlement
JOIN "factory_purchase_orders" purchase_order
  ON purchase_order."id" = settlement."purchase_order_id"
JOIN "sales_executions" execution
  ON execution."id" = purchase_order."execution_id"
LEFT JOIN "receivable_orders" receivable_order
  ON receivable_order."source_sales_execution_id" = execution."id"
 AND receivable_order."deleted_at" IS NULL
LEFT JOIN "order_costs" settlement_cost
  ON settlement_cost."source_type" = 'FACTORY_PURCHASE_SETTLEMENT'
 AND settlement_cost."source_id" = purchase_order."id"
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE adjustment."status" = 'PROVISIONAL')::INTEGER AS provisional_count,
    COUNT(*) FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."currency" IS DISTINCT FROM purchase_order."purchase_currency"
    )::INTEGER AS invalid_currency_count,
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'INCREASE'
    ), 0)::NUMERIC(18,2) AS ordinary_increase,
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'DECREASE'
    ), 0)::NUMERIC(18,2) AS ordinary_decrease,
    COUNT(*) FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" = 'DELAY_PENALTY'
    )::INTEGER AS delay_count,
    COUNT(*) FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" = 'DELAY_PENALTY'
        AND (
          adjustment."direction" <> 'DECREASE'
          OR adjustment."currency" IS DISTINCT FROM purchase_order."purchase_currency"
        )
    )::INTEGER AS invalid_delay_count,
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" = 'DELAY_PENALTY'
    ), 0)::NUMERIC(18,2) AS delay_amount
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."purchase_order_id" = purchase_order."id"
) adjustment_totals ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(payment."amount"), 0)::NUMERIC(18,2) AS confirmed_at_settlement
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = purchase_order."id"
    AND payment."created_at" <= settlement."created_at"
    AND (
      payment."status" = 'CONFIRMED'
      OR (
        payment."status" = 'VOIDED'
        AND payment."voided_at" IS NOT NULL
        AND payment."voided_at" > settlement."created_at"
      )
    )
) historical_payments ON TRUE
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(payment."amount") FILTER (
      WHERE payment."status" = 'CONFIRMED'
    ), 0)::NUMERIC(18,2) AS confirmed_paid,
    MAX(payment."paid_at") FILTER (
      WHERE payment."status" = 'CONFIRMED'
    ) AS latest_paid_date,
    CASE
      WHEN COALESCE(SUM(payment."amount") FILTER (
        WHERE payment."status" = 'CONFIRMED'
      ), 0) = settlement."final_payable_amount" THEN '已支付'
      WHEN COALESCE(SUM(payment."amount") FILTER (
        WHERE payment."status" = 'CONFIRMED'
      ), 0) > 0 THEN '部分支付'
      ELSE '待支付'
    END AS expected_payment_status,
    (
      COALESCE(SUM(payment."amount") FILTER (
        WHERE payment."status" = 'CONFIRMED'
      ), 0) > 0
      OR COALESCE(SUM(payment."amount") FILTER (
        WHERE payment."status" = 'CONFIRMED'
      ), 0) = settlement."final_payable_amount"
    ) AS expected_paid,
    CASE
      WHEN COALESCE(SUM(payment."amount") FILTER (
        WHERE payment."status" = 'CONFIRMED'
      ), 0) > 0 THEN MAX(payment."paid_at") FILTER (
        WHERE payment."status" = 'CONFIRMED'
      )
      WHEN settlement."final_payable_amount" = 0 THEN purchase_order."actual_delivery_date"
      ELSE NULL
    END AS expected_payment_date
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = purchase_order."id"
) current_payments ON TRUE
LEFT JOIN LATERAL (
  SELECT
    GREATEST(
      purchase_order."actual_delivery_date"
        - purchase_order."initial_supplier_delivery_date"
        - purchase_order."delay_grace_days",
      0
    )::INTEGER AS delay_days,
    CASE
      WHEN purchase_order."delay_penalty_cap_ratio" IS NULL THEN ROUND(
        purchase_order."penalty_base_amount"
          * purchase_order."delay_penalty_rate_per_day"
          * GREATEST(
            purchase_order."actual_delivery_date"
              - purchase_order."initial_supplier_delivery_date"
              - purchase_order."delay_grace_days",
            0
          ),
        2
      )
      ELSE LEAST(
        ROUND(
          purchase_order."penalty_base_amount"
            * purchase_order."delay_penalty_rate_per_day"
            * GREATEST(
              purchase_order."actual_delivery_date"
                - purchase_order."initial_supplier_delivery_date"
                - purchase_order."delay_grace_days",
              0
            ),
          2
        ),
        ROUND(
          purchase_order."penalty_base_amount" * purchase_order."delay_penalty_cap_ratio",
          2
        )
      )
    END::NUMERIC(18,2) AS delay_penalty,
    ROUND(
      purchase_order."penalty_base_amount"
        + adjustment_totals.ordinary_increase
        - adjustment_totals.ordinary_decrease
        - CASE
          WHEN purchase_order."delay_penalty_cap_ratio" IS NULL THEN ROUND(
            purchase_order."penalty_base_amount"
              * purchase_order."delay_penalty_rate_per_day"
              * GREATEST(
                purchase_order."actual_delivery_date"
                  - purchase_order."initial_supplier_delivery_date"
                  - purchase_order."delay_grace_days",
                0
              ),
            2
          )
          ELSE LEAST(
            ROUND(
              purchase_order."penalty_base_amount"
                * purchase_order."delay_penalty_rate_per_day"
                * GREATEST(
                  purchase_order."actual_delivery_date"
                    - purchase_order."initial_supplier_delivery_date"
                    - purchase_order."delay_grace_days",
                  0
                ),
              2
            ),
            ROUND(
              purchase_order."penalty_base_amount" * purchase_order."delay_penalty_cap_ratio",
              2
            )
          )
        END,
      2
    )::NUMERIC(18,2) AS final_payable
) expected_amounts ON TRUE;

DO $$
DECLARE
  invalid_settlement RECORD;
BEGIN
  SELECT settlement_id, purchase_order_id, invalid_reason
  INTO invalid_settlement
  FROM "_factory_settlement_integrity_audit"
  WHERE invalid_reason IS NOT NULL
  ORDER BY settlement_id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'factory settlement % for purchase order % failed integrity audit: %',
      invalid_settlement.settlement_id,
      invalid_settlement.purchase_order_id,
      invalid_settlement.invalid_reason;
  END IF;
END;
$$;

-- User-entered ledger evidence cannot be dated in the future. Shanghai date is
-- used consistently with the application validation.
CREATE FUNCTION "guard_factory_purchase_financial_dates"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'factory_purchase_order_payments'
    AND NEW."paid_at" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::DATE THEN
    RAISE EXCEPTION 'factory purchase payment date cannot be in the future';
  END IF;
  IF TG_TABLE_NAME = 'factory_purchase_order_settlements'
    AND NEW."exchange_rate_date" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::DATE THEN
    RAISE EXCEPTION 'factory settlement exchange-rate date cannot be in the future';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_payments_date_guard"
  BEFORE INSERT OR UPDATE OF "paid_at" ON "factory_purchase_order_payments"
  FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_financial_dates"();
CREATE TRIGGER "factory_purchase_order_settlements_date_guard"
  BEFORE INSERT OR UPDATE OF "exchange_rate_date" ON "factory_purchase_order_settlements"
  FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_financial_dates"();

-- A delivered or settled purchase order cannot be disconnected from its
-- immutable settlement and active cost by a direct status update.
CREATE FUNCTION "guard_factory_purchase_order_void_after_commitment"() RETURNS trigger AS $$
DECLARE
  shipping_started_at TIMESTAMP(3);
  has_receivable_order BOOLEAN;
  has_settlement BOOLEAN;
BEGIN
  IF OLD."status" = NEW."status" OR NEW."status" <> 'VOIDED'::"FactoryPurchaseOrderStatus" THEN
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
  IF has_settlement
    OR shipping_started_at IS NOT NULL
    OR has_receivable_order
    OR OLD."actual_delivery_date" IS NOT NULL THEN
    RAISE EXCEPTION 'delivered or settled factory purchase order cannot be voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_orders_committed_void_guard"
  BEFORE UPDATE OF "status" ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "guard_factory_purchase_order_void_after_commitment"();

-- The cost stores display labels derived from the immutable settlement
-- currency. Enforce them at the database boundary instead of trusting a
-- single application write path.
CREATE FUNCTION "guard_factory_settlement_order_cost_metadata"() RETURNS trigger AS $$
DECLARE
  settlement_currency TEXT;
  expected_source TEXT;
  expected_type TEXT;
BEGIN
  IF NEW."source_type" <> 'FACTORY_PURCHASE_SETTLEMENT' THEN RETURN NEW; END IF;
  SELECT settlement."currency"
  INTO settlement_currency
  FROM "factory_purchase_order_settlements" settlement
  WHERE settlement."purchase_order_id" = NEW."source_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory settlement cost requires an existing settlement';
  END IF;
  expected_source := CASE WHEN settlement_currency = 'CNY' THEN '系统' ELSE '历史录入' END;
  expected_type := CASE WHEN settlement_currency = 'CNY' THEN '人民币' ELSE '采购结算' END;
  IF NEW."exchange_rate_source" IS DISTINCT FROM expected_source
    OR NEW."exchange_rate_type" IS DISTINCT FROM expected_type THEN
    RAISE EXCEPTION 'factory settlement cost exchange-rate metadata is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "order_costs_factory_settlement_metadata_guard"
  BEFORE INSERT OR UPDATE ON "order_costs"
  FOR EACH ROW EXECUTE FUNCTION "guard_factory_settlement_order_cost_metadata"();

-- Validate the final state at COMMIT. This permits the legitimate application
-- transaction to insert a payment and then synchronize settlement + cost, but
-- rejects raw single-table writes that leave the three ledgers inconsistent.
CREATE FUNCTION "assert_factory_purchase_settlement_commit_consistency"() RETURNS trigger AS $$
DECLARE
  target_purchase_order_id TEXT;
  settlement_record RECORD;
  settlement_cost RECORD;
  confirmed_paid NUMERIC(18,2);
  latest_paid_date DATE;
  expected_payment_status TEXT;
  expected_paid BOOLEAN;
  expected_payment_date DATE;
BEGIN
  target_purchase_order_id := CASE
    WHEN TG_TABLE_NAME = 'factory_purchase_order_settlements' THEN
      CASE WHEN TG_OP = 'DELETE' THEN OLD."purchase_order_id" ELSE NEW."purchase_order_id" END
    WHEN TG_TABLE_NAME = 'factory_purchase_order_payments' THEN
      CASE WHEN TG_OP = 'DELETE' THEN OLD."purchase_order_id" ELSE NEW."purchase_order_id" END
    WHEN TG_TABLE_NAME = 'factory_purchase_orders' THEN
      CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END
    ELSE
      CASE
        WHEN TG_OP = 'DELETE' AND OLD."source_type" = 'FACTORY_PURCHASE_SETTLEMENT'
          THEN OLD."source_id"
        WHEN TG_OP <> 'DELETE' AND NEW."source_type" = 'FACTORY_PURCHASE_SETTLEMENT'
          THEN NEW."source_id"
        WHEN TG_OP = 'UPDATE' AND OLD."source_type" = 'FACTORY_PURCHASE_SETTLEMENT'
          THEN OLD."source_id"
        ELSE NULL
      END
  END;
  IF target_purchase_order_id IS NULL THEN RETURN NULL; END IF;

  SELECT settlement."status", settlement."final_payable_amount",
         settlement."paid_amount_at_settlement", settlement."settled_at",
         settlement."settled_by", purchase_order."status" AS purchase_order_status,
         purchase_order."actual_delivery_date"
  INTO settlement_record
  FROM "factory_purchase_order_settlements" settlement
  JOIN "factory_purchase_orders" purchase_order
    ON purchase_order."id" = settlement."purchase_order_id"
  WHERE settlement."purchase_order_id" = target_purchase_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF settlement_record.purchase_order_status <> 'ACCEPTED'::"FactoryPurchaseOrderStatus" THEN
    RAISE EXCEPTION 'factory settlement requires an accepted purchase order';
  END IF;

  SELECT COALESCE(SUM(payment."amount"), 0)::NUMERIC(18,2),
         MAX(payment."paid_at")
  INTO confirmed_paid, latest_paid_date
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = target_purchase_order_id
    AND payment."status" = 'CONFIRMED';
  IF confirmed_paid > settlement_record.final_payable_amount THEN
    RAISE EXCEPTION 'factory settlement payments exceed final payable amount';
  END IF;
  IF confirmed_paid = settlement_record.final_payable_amount THEN
    IF settlement_record.status <> 'SETTLED'::"FactoryPurchaseSettlementStatus"
      OR settlement_record.paid_amount_at_settlement IS DISTINCT FROM confirmed_paid
      OR settlement_record.settled_at IS NULL
      OR settlement_record.settled_by IS NULL THEN
      RAISE EXCEPTION 'fully paid factory settlement must be closed in the same transaction';
    END IF;
  ELSIF settlement_record.status <> 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    OR settlement_record.settled_at IS NOT NULL
    OR settlement_record.settled_by IS NOT NULL THEN
    RAISE EXCEPTION 'partially paid factory settlement must remain pending';
  END IF;

  expected_payment_status := CASE
    WHEN confirmed_paid = settlement_record.final_payable_amount THEN '已支付'
    WHEN confirmed_paid > 0 THEN '部分支付'
    ELSE '待支付'
  END;
  expected_paid := confirmed_paid > 0
    OR confirmed_paid = settlement_record.final_payable_amount;
  expected_payment_date := CASE
    WHEN confirmed_paid > 0 THEN latest_paid_date
    WHEN settlement_record.final_payable_amount = 0 THEN settlement_record.actual_delivery_date
    ELSE NULL
  END;

  SELECT cost."id", cost."payment_status", cost."paid",
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
  IF settlement_cost.payment_status IS DISTINCT FROM expected_payment_status
    OR settlement_cost.paid IS DISTINCT FROM expected_paid
    OR settlement_cost.payment_date IS DISTINCT FROM expected_payment_date
    OR settlement_cost.paid_at IS DISTINCT FROM expected_payment_date THEN
    RAISE EXCEPTION 'factory settlement cost payment state is out of sync';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "factory_purchase_payments_commit_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "factory_purchase_order_payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_factory_purchase_settlement_commit_consistency"();
CREATE CONSTRAINT TRIGGER "factory_purchase_settlements_commit_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "factory_purchase_order_settlements"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_factory_purchase_settlement_commit_consistency"();
CREATE CONSTRAINT TRIGGER "factory_purchase_costs_commit_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "order_costs"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "assert_factory_purchase_settlement_commit_consistency"();
CREATE CONSTRAINT TRIGGER "factory_purchase_orders_commit_consistency"
  AFTER UPDATE OF "status" ON "factory_purchase_orders"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_factory_purchase_settlement_commit_consistency"();

COMMIT;
