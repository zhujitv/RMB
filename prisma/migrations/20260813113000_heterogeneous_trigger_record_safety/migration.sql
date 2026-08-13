-- Forward-only correction: several trigger functions are intentionally shared
-- by tables with different row shapes.  PostgreSQL resolves OLD/NEW record
-- fields when the PL/pgSQL statement is executed, including fields mentioned
-- in CASE branches that are not selected for the current table.  Convert the
-- transition records to JSONB before selecting table-specific identifiers so
-- an unrelated row shape cannot raise SQLSTATE 42703.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

CREATE OR REPLACE FUNCTION "guard_factory_purchase_financial_dates"() RETURNS trigger AS $$
DECLARE
  new_row JSONB;
  financial_date DATE;
BEGIN
  new_row := to_jsonb(NEW);

  IF TG_TABLE_NAME = 'factory_purchase_order_payments' THEN
    financial_date := NULLIF(new_row ->> 'paid_at', '')::DATE;
    IF financial_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::DATE THEN
      RAISE EXCEPTION 'factory purchase payment date cannot be in the future';
    END IF;
  ELSIF TG_TABLE_NAME = 'factory_purchase_order_settlements' THEN
    financial_date := NULLIF(new_row ->> 'exchange_rate_date', '')::DATE;
    IF financial_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::DATE THEN
      RAISE EXCEPTION 'factory settlement exchange-rate date cannot be in the future';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "assert_sales_quotation_decision_commit_consistency"() RETURNS trigger AS $$
DECLARE
  target_quotation_id TEXT;
  old_row JSONB;
  new_row JSONB;
  quotation_record RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;

  target_quotation_id := CASE
    WHEN TG_TABLE_NAME = 'sales_quotations' AND TG_OP = 'DELETE' THEN old_row ->> 'id'
    WHEN TG_TABLE_NAME = 'sales_quotations' THEN new_row ->> 'id'
    WHEN TG_TABLE_NAME = 'sales_quotation_decisions' AND TG_OP = 'DELETE' THEN old_row ->> 'quotation_id'
    WHEN TG_TABLE_NAME = 'sales_quotation_decisions' THEN new_row ->> 'quotation_id'
    ELSE NULL
  END;
  IF target_quotation_id IS NULL THEN RETURN NULL; END IF;

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

CREATE OR REPLACE FUNCTION "assert_factory_purchase_settlement_commit_consistency"() RETURNS trigger AS $$
DECLARE
  target_purchase_order_id TEXT;
  old_row JSONB;
  new_row JSONB;
  settlement_record RECORD;
  settlement_cost RECORD;
  confirmed_paid NUMERIC(18,2);
  latest_paid_date DATE;
  expected_payment_status TEXT;
  expected_paid BOOLEAN;
  expected_payment_date DATE;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;

  target_purchase_order_id := CASE
    WHEN TG_TABLE_NAME IN ('factory_purchase_order_settlements', 'factory_purchase_order_payments')
      AND TG_OP = 'DELETE' THEN old_row ->> 'purchase_order_id'
    WHEN TG_TABLE_NAME IN ('factory_purchase_order_settlements', 'factory_purchase_order_payments')
      THEN new_row ->> 'purchase_order_id'
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

COMMIT;
