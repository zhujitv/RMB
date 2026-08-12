BEGIN;

-- Freeze settlement and purchase-ledger writes while auditing rows that may
-- have been created under the lifecycle-only 0430 guard.
LOCK TABLE "factory_purchase_orders",
           "factory_purchase_order_payments",
           "factory_purchase_order_settlements"
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  invalid_settlement_id TEXT;
BEGIN
  SELECT settlement."id"
  INTO invalid_settlement_id
  FROM "factory_purchase_order_settlements" settlement
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(payment."amount"), 0)::NUMERIC(18,2) AS confirmed_paid
    FROM "factory_purchase_order_payments" payment
    WHERE payment."purchase_order_id" = settlement."purchase_order_id"
      AND payment."status" = 'CONFIRMED'
  ) ledger ON TRUE
  WHERE (
      settlement."status" = 'SETTLED'
      AND (
        settlement."paid_amount_at_settlement" IS DISTINCT FROM ledger.confirmed_paid
        OR ledger.confirmed_paid IS DISTINCT FROM settlement."final_payable_amount"
      )
    )
    OR (
      settlement."status" = 'PENDING_PAYMENT'
      AND (
        settlement."paid_amount_at_settlement" > ledger.confirmed_paid
        OR ledger.confirmed_paid >= settlement."final_payable_amount"
        OR settlement."paid_amount_at_settlement" > settlement."final_payable_amount"
      )
    )
  ORDER BY settlement."id"
  LIMIT 1;

  IF invalid_settlement_id IS NOT NULL THEN
    RAISE EXCEPTION
      'existing factory settlement % does not match its confirmed payment ledger',
      invalid_settlement_id;
  END IF;
END;
$$;

-- Replaces the original lifecycle-only insert guard with a locked financial
-- reconstruction. The parent lock serializes legitimate service writes and
-- also blocks concurrent child inserts through their purchase-order FKs.
CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_settlement_insert"() RETURNS trigger AS $$
DECLARE
  target_execution_id TEXT;
  purchase_order RECORD;
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
  FROM "factory_purchase_orders" purchase_order_row
  WHERE purchase_order_row."id" = NEW."purchase_order_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory settlement purchase order does not exist';
  END IF;

  -- Keep the established global lock order: sales execution, purchase order,
  -- then its ledger rows.
  PERFORM execution."id"
  FROM "sales_executions" execution
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
  FROM "factory_purchase_orders" purchase_order_row
  JOIN "sales_executions" execution ON execution."id" = purchase_order_row."execution_id"
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
  IF NEW."currency" IS DISTINCT FROM purchase_order."purchase_currency"
    OR NEW."base_amount" IS DISTINCT FROM purchase_order."penalty_base_amount" THEN
    RAISE EXCEPTION 'factory settlement currency or frozen base does not match the purchase order';
  END IF;
  IF NEW."exchange_rate" <= 0
    OR (NEW."currency" = 'CNY' AND NEW."exchange_rate" <> 1) THEN
    RAISE EXCEPTION 'factory settlement exchange rate is invalid';
  END IF;

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
  FROM "factory_purchase_order_adjustments" adjustment
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
    purchase_order."penalty_base_amount"
      + ordinary_increase
      - ordinary_decrease
      - expected_delay_penalty,
    2
  );
  IF expected_final_payable < 0
    OR NEW."final_payable_amount" IS DISTINCT FROM expected_final_payable THEN
    RAISE EXCEPTION 'factory settlement final payable does not match the purchase ledger';
  END IF;

  SELECT COALESCE(SUM(payment."amount"), 0)
  INTO confirmed_paid
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = NEW."purchase_order_id"
    AND payment."status" = 'CONFIRMED';
  IF NEW."paid_amount_at_settlement" IS DISTINCT FROM confirmed_paid THEN
    RAISE EXCEPTION 'factory settlement paid amount does not match confirmed purchase payments';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A pending snapshot may only close when the immutable purchase-payment
-- ledger itself has reached the exact final payable amount. Rewriting the
-- snapshot fields alone must never be enough to manufacture a settled state.
CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_settlement"() RETURNS trigger AS $$
DECLARE
  confirmed_paid NUMERIC(18,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase settlements cannot be deleted';
  END IF;
  IF OLD."status" = 'SETTLED' THEN
    RAISE EXCEPTION 'settled factory purchase settlement is immutable';
  END IF;
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

  PERFORM purchase_order."id"
  FROM "factory_purchase_orders" purchase_order
  WHERE purchase_order."id" = NEW."purchase_order_id"
  FOR UPDATE;
  PERFORM payment."id"
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY payment."sequence_no", payment."id"
  FOR UPDATE;

  SELECT COALESCE(SUM(payment."amount"), 0)::NUMERIC(18,2)
  INTO confirmed_paid
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = NEW."purchase_order_id"
    AND payment."status" = 'CONFIRMED';

  IF NEW."status" <> 'SETTLED'
    OR confirmed_paid IS DISTINCT FROM NEW."final_payable_amount"
    OR NEW."paid_amount_at_settlement" IS DISTINCT FROM confirmed_paid
    OR NEW."settled_at" IS NULL
    OR NEW."settled_by" IS NULL THEN
    RAISE EXCEPTION 'pending factory purchase settlement may only close against fully confirmed payments';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
