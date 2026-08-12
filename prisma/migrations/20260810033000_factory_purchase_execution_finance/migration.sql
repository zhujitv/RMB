-- Procurement execution remains independent per factory purchase order. These
-- records exist before QC release and therefore must not create ReceivableOrder
-- or OrderCost rows.
CREATE TYPE "FactoryPurchaseOrderProductionStatus" AS ENUM (
  'WAITING_SUPPLIER',
  'WAITING_PREPAYMENT',
  'READY',
  'IN_PRODUCTION',
  'COMPLETED'
);

CREATE TYPE "FactoryPurchasePaymentKind" AS ENUM ('PREPAYMENT', 'BALANCE');
CREATE TYPE "FactoryPurchaseLedgerStatus" AS ENUM ('CONFIRMED', 'VOIDED');
CREATE TYPE "FactoryPurchaseAdjustmentKind" AS ENUM ('TEMPORARY_FEE', 'DELAY_PENALTY', 'OTHER');
CREATE TYPE "FactoryPurchaseAdjustmentDirection" AS ENUM ('INCREASE', 'DECREASE');
CREATE TYPE "FactoryPurchaseAdjustmentStatus" AS ENUM ('PROVISIONAL', 'CONFIRMED', 'VOIDED');

ALTER TABLE "suppliers"
  ADD COLUMN "purchase_prepayment_ratio" DECIMAL(8,6) NOT NULL DEFAULT 0,
  ADD COLUMN "purchase_prepayment_required_before_production" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "suppliers_purchase_prepayment_ratio_check"
    CHECK ("purchase_prepayment_ratio" >= 0 AND "purchase_prepayment_ratio" <= 1),
  ADD CONSTRAINT "suppliers_purchase_prepayment_gate_check"
    CHECK (NOT "purchase_prepayment_required_before_production" OR "purchase_prepayment_ratio" > 0);

ALTER TABLE "factory_purchase_orders"
  ADD COLUMN "prepayment_ratio" DECIMAL(8,6) NOT NULL DEFAULT 0,
  ADD COLUMN "prepayment_required_before_production" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "initial_supplier_delivery_date" DATE,
  ADD COLUMN "penalty_base_amount" DECIMAL(18,2),
  ADD COLUMN "delay_grace_days" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "delay_penalty_rate_per_day" DECIMAL(12,8) NOT NULL DEFAULT 0.00003000,
  ADD COLUMN "delay_penalty_cap_ratio" DECIMAL(8,6),
  ADD COLUMN "production_status" "FactoryPurchaseOrderProductionStatus" NOT NULL DEFAULT 'WAITING_SUPPLIER',
  ADD COLUMN "production_started_at" TIMESTAMP(3),
  ADD COLUMN "production_started_by" TEXT,
  ADD COLUMN "production_completed_at" TIMESTAMP(3),
  ADD COLUMN "production_completed_by" TEXT,
  ADD CONSTRAINT "factory_purchase_orders_prepayment_ratio_check"
    CHECK ("prepayment_ratio" >= 0 AND "prepayment_ratio" <= 1),
  ADD CONSTRAINT "factory_purchase_orders_prepayment_gate_check"
    CHECK (NOT "prepayment_required_before_production" OR "prepayment_ratio" > 0),
  ADD CONSTRAINT "factory_purchase_orders_penalty_rule_check"
    CHECK (
      "delay_grace_days" >= 0
      AND "delay_penalty_rate_per_day" >= 0
      AND ("delay_penalty_cap_ratio" IS NULL OR ("delay_penalty_cap_ratio" >= 0 AND "delay_penalty_cap_ratio" <= 1))
      AND ("penalty_base_amount" IS NULL OR "penalty_base_amount" >= 0)
    ),
  ADD CONSTRAINT "factory_purchase_orders_production_audit_check"
    CHECK (
      (
        "production_status" IN ('WAITING_SUPPLIER', 'WAITING_PREPAYMENT', 'READY')
        AND "production_started_at" IS NULL
        AND "production_started_by" IS NULL
        AND "production_completed_at" IS NULL
        AND "production_completed_by" IS NULL
      )
      OR (
        "production_status" = 'IN_PRODUCTION'
        AND "production_started_at" IS NOT NULL
        AND "production_started_by" IS NOT NULL
        AND "production_completed_at" IS NULL
        AND "production_completed_by" IS NULL
      )
      OR (
        "production_status" = 'COMPLETED'
        AND "production_started_at" IS NOT NULL
        AND "production_started_by" IS NOT NULL
        AND "production_completed_at" IS NOT NULL
        AND "production_completed_by" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX "factory_purchase_orders_id_purchase_currency_key"
  ON "factory_purchase_orders"("id", "purchase_currency");
CREATE INDEX "factory_purchase_orders_production_status_updated_at_idx"
  ON "factory_purchase_orders"("production_status", "updated_at");
CREATE INDEX "factory_purchase_orders_production_started_by_idx"
  ON "factory_purchase_orders"("production_started_by");
CREATE INDEX "factory_purchase_orders_production_completed_by_idx"
  ON "factory_purchase_orders"("production_completed_by");

ALTER TABLE "factory_purchase_orders"
  ADD CONSTRAINT "factory_purchase_orders_production_started_by_fkey"
    FOREIGN KEY ("production_started_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_orders_production_completed_by_fkey"
    FOREIGN KEY ("production_completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill the first non-rejected supplier date without parsing any legacy
-- free-text payment terms. Later date proposals remain in the immutable history.
WITH first_delivery AS (
  SELECT DISTINCT ON ("purchase_order_id")
    "purchase_order_id",
    "delivery_date"
  FROM "factory_purchase_order_supplier_responses"
  WHERE "action" <> 'REJECTED' AND "delivery_date" IS NOT NULL
  ORDER BY "purchase_order_id", "response_sequence" ASC
)
UPDATE "factory_purchase_orders" purchase_order
SET "initial_supplier_delivery_date" = first_delivery."delivery_date",
    "production_status" = 'READY'
FROM first_delivery
WHERE purchase_order."id" = first_delivery."purchase_order_id"
  AND purchase_order."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED');

WITH order_totals AS (
  SELECT
    purchase_order."id" AS "purchase_order_id",
    CASE
      WHEN COUNT(item."id") = 0
        OR COUNT(*) FILTER (WHERE COALESCE(supplier_price."amount", item."amount") IS NULL) > 0
      THEN NULL
      ELSE ROUND(SUM(COALESCE(supplier_price."amount", item."amount")), 2)
    END AS "penalty_base_amount"
  FROM "factory_purchase_orders" purchase_order
  LEFT JOIN "factory_purchase_order_items" item
    ON item."purchase_order_id" = purchase_order."id"
  LEFT JOIN "factory_purchase_order_supplier_prices" supplier_price
    ON supplier_price."purchase_order_id" = purchase_order."id"
    AND supplier_price."purchase_order_item_id" = item."id"
  GROUP BY purchase_order."id"
)
UPDATE "factory_purchase_orders" purchase_order
SET "penalty_base_amount" = order_totals."penalty_base_amount"
FROM order_totals
WHERE purchase_order."id" = order_totals."purchase_order_id"
  AND purchase_order."initial_supplier_delivery_date" IS NOT NULL;

CREATE TABLE "factory_purchase_order_payments" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "kind" "FactoryPurchasePaymentKind" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "paid_at" DATE NOT NULL,
  "bank_reference" TEXT,
  "remark" TEXT,
  "status" "FactoryPurchaseLedgerStatus" NOT NULL DEFAULT 'CONFIRMED',
  "idempotency_key" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "voided_by" TEXT,
  "voided_at" TIMESTAMP(3),
  "void_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "factory_purchase_order_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "factory_purchase_order_payments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "factory_purchase_order_payments_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "factory_purchase_order_payments_void_check" CHECK (
    ("status" = 'CONFIRMED' AND "voided_by" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
    OR
    ("status" = 'VOIDED' AND "voided_by" IS NOT NULL AND "voided_at" IS NOT NULL AND NULLIF(BTRIM("void_reason"), '') IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "factory_purchase_order_payments_purchase_order_id_sequence_no_key"
  ON "factory_purchase_order_payments"("purchase_order_id", "sequence_no");
CREATE UNIQUE INDEX "factory_purchase_order_payments_purchase_order_id_idempotency_key_key"
  ON "factory_purchase_order_payments"("purchase_order_id", "idempotency_key");
CREATE INDEX "factory_purchase_order_payments_po_status_kind_paid_at_idx"
  ON "factory_purchase_order_payments"("purchase_order_id", "status", "kind", "paid_at");
CREATE INDEX "factory_purchase_order_payments_created_by_idx"
  ON "factory_purchase_order_payments"("created_by");
CREATE INDEX "factory_purchase_order_payments_voided_by_idx"
  ON "factory_purchase_order_payments"("voided_by");

ALTER TABLE "factory_purchase_order_payments"
  ADD CONSTRAINT "factory_purchase_order_payments_po_currency_fkey"
    FOREIGN KEY ("purchase_order_id", "currency")
    REFERENCES "factory_purchase_orders"("id", "purchase_currency") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_payments_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_payments_voided_by_fkey"
    FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "factory_purchase_order_adjustments" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "kind" "FactoryPurchaseAdjustmentKind" NOT NULL,
  "direction" "FactoryPurchaseAdjustmentDirection" NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "occurred_at" DATE,
  "status" "FactoryPurchaseAdjustmentStatus" NOT NULL DEFAULT 'PROVISIONAL',
  "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
  "source_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by" TEXT NOT NULL,
  "confirmed_by" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "voided_by" TEXT,
  "voided_at" TIMESTAMP(3),
  "void_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "factory_purchase_order_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "factory_purchase_order_adjustments_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "factory_purchase_order_adjustments_sequence_check" CHECK ("sequence_no" > 0),
  CONSTRAINT "factory_purchase_order_adjustments_description_check" CHECK (NULLIF(BTRIM("description"), '') IS NOT NULL),
  CONSTRAINT "factory_purchase_order_adjustments_status_check" CHECK (
    ("status" = 'PROVISIONAL' AND "confirmed_by" IS NULL AND "confirmed_at" IS NULL AND "voided_by" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
    OR
    ("status" = 'CONFIRMED' AND "confirmed_by" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "voided_by" IS NULL AND "voided_at" IS NULL AND "void_reason" IS NULL)
    OR
    ("status" = 'VOIDED' AND "voided_by" IS NOT NULL AND "voided_at" IS NOT NULL AND NULLIF(BTRIM("void_reason"), '') IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "factory_purchase_order_adjustments_purchase_order_id_sequence_no_key"
  ON "factory_purchase_order_adjustments"("purchase_order_id", "sequence_no");
CREATE UNIQUE INDEX "factory_purchase_order_adjustments_po_source_key"
  ON "factory_purchase_order_adjustments"("purchase_order_id", "source_type", "source_id");
CREATE INDEX "factory_purchase_order_adjustments_po_status_kind_idx"
  ON "factory_purchase_order_adjustments"("purchase_order_id", "status", "kind");
CREATE INDEX "factory_purchase_order_adjustments_created_by_idx"
  ON "factory_purchase_order_adjustments"("created_by");
CREATE INDEX "factory_purchase_order_adjustments_confirmed_by_idx"
  ON "factory_purchase_order_adjustments"("confirmed_by");
CREATE INDEX "factory_purchase_order_adjustments_voided_by_idx"
  ON "factory_purchase_order_adjustments"("voided_by");

ALTER TABLE "factory_purchase_order_adjustments"
  ADD CONSTRAINT "factory_purchase_order_adjustments_po_currency_fkey"
    FOREIGN KEY ("purchase_order_id", "currency")
    REFERENCES "factory_purchase_orders"("id", "purchase_currency") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_adjustments_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_adjustments_confirmed_by_fkey"
    FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_adjustments_voided_by_fkey"
    FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot fields remain editable while the factory PO is a draft, then are
-- frozen with the outbound document. Execution state and ledgers stay mutable
-- only through their dedicated audited services.
CREATE OR REPLACE FUNCTION "reject_locked_factory_purchase_order_core_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'dispatched factory purchase orders cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."execution_id" IS DISTINCT FROM OLD."execution_id"
    OR NEW."sequence_no" IS DISTINCT FROM OLD."sequence_no"
    OR NEW."po_no" IS DISTINCT FROM OLD."po_no"
    OR NEW."supplier_id" IS DISTINCT FROM OLD."supplier_id"
    OR NEW."supplier_name_snapshot" IS DISTINCT FROM OLD."supplier_name_snapshot"
    OR NEW."purchase_currency" IS DISTINCT FROM OLD."purchase_currency"
    OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
    OR NEW."requested_delivery_date" IS DISTINCT FROM OLD."requested_delivery_date"
    OR NEW."payment_term" IS DISTINCT FROM OLD."payment_term"
    OR NEW."prepayment_ratio" IS DISTINCT FROM OLD."prepayment_ratio"
    OR NEW."prepayment_required_before_production" IS DISTINCT FROM OLD."prepayment_required_before_production"
    OR NEW."delay_grace_days" IS DISTINCT FROM OLD."delay_grace_days"
    OR NEW."delay_penalty_rate_per_day" IS DISTINCT FROM OLD."delay_penalty_rate_per_day"
    OR NEW."delay_penalty_cap_ratio" IS DISTINCT FROM OLD."delay_penalty_cap_ratio"
    OR NEW."remark" IS DISTINCT FROM OLD."remark"
    OR NEW."dispatched_at" IS DISTINCT FROM OLD."dispatched_at"
    OR NEW."dispatched_by" IS DISTINCT FROM OLD."dispatched_by"
    OR NEW."dispatch_version_number" IS DISTINCT FROM OLD."dispatch_version_number"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'dispatched factory purchase order core fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "protect_factory_purchase_order_execution_anchors"() RETURNS trigger AS $$
BEGIN
  IF OLD."initial_supplier_delivery_date" IS NOT NULL
    AND NEW."initial_supplier_delivery_date" IS DISTINCT FROM OLD."initial_supplier_delivery_date" THEN
    RAISE EXCEPTION 'initial supplier delivery date is immutable';
  END IF;
  IF OLD."penalty_base_amount" IS NOT NULL
    AND NEW."penalty_base_amount" IS DISTINCT FROM OLD."penalty_base_amount" THEN
    RAISE EXCEPTION 'factory purchase order penalty base is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_orders_execution_anchor_guard"
  BEFORE UPDATE ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_execution_anchors"();

CREATE FUNCTION "protect_factory_purchase_order_payment"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase order payment records cannot be deleted';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'voided factory purchase order payment is immutable';
  END IF;
  IF NEW."purchase_order_id" IS DISTINCT FROM OLD."purchase_order_id"
    OR NEW."sequence_no" IS DISTINCT FROM OLD."sequence_no"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."paid_at" IS DISTINCT FROM OLD."paid_at"
    OR NEW."bank_reference" IS DISTINCT FROM OLD."bank_reference"
    OR NEW."remark" IS DISTINCT FROM OLD."remark"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'confirmed factory purchase order payment core fields are immutable';
  END IF;
  IF NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'factory purchase order payment may only be voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_payments_immutability_guard"
  BEFORE UPDATE OR DELETE ON "factory_purchase_order_payments"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_payment"();

CREATE FUNCTION "validate_factory_purchase_order_ledger_parent"() RETURNS trigger AS $$
DECLARE
  parent_status "FactoryPurchaseOrderStatus";
BEGIN
  SELECT "status" INTO parent_status
  FROM "factory_purchase_orders"
  WHERE "id" = NEW."purchase_order_id"
  FOR KEY SHARE;
  IF parent_status NOT IN ('ACCEPTED', 'DELIVERY_PROPOSED') THEN
    RAISE EXCEPTION 'factory purchase order ledger requires an accepted active purchase order';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_payments_parent_guard"
  BEFORE INSERT ON "factory_purchase_order_payments"
  FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_ledger_parent"();
CREATE TRIGGER "factory_purchase_order_adjustments_parent_guard"
  BEFORE INSERT ON "factory_purchase_order_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_ledger_parent"();

CREATE FUNCTION "protect_factory_purchase_order_adjustment"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase order adjustments cannot be deleted';
  END IF;
  IF OLD."status" IN ('CONFIRMED', 'VOIDED') THEN
    RAISE EXCEPTION 'confirmed or voided factory purchase order adjustment is immutable';
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
  IF NEW."status" NOT IN ('CONFIRMED', 'VOIDED') THEN
    RAISE EXCEPTION 'factory purchase order adjustment may only be confirmed or voided';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_adjustments_immutability_guard"
  BEFORE UPDATE OR DELETE ON "factory_purchase_order_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_adjustment"();
