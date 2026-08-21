-- Allow a narrowly scoped, audited quantity-correction service to repair
-- direct-created sales executions after dispatch. Normal application and raw
-- SQL writes remain locked by the existing dispatch immutability guards.

CREATE OR REPLACE FUNCTION "reject_locked_sales_execution_item_mutation"() RETURNS trigger AS $$
DECLARE
  old_parent_status "SalesExecutionStatus";
  new_parent_status "SalesExecutionStatus";
  quantity_correction BOOLEAN := current_setting('app.sales_quantity_correction', true) = 'on';
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_parent_status
      FROM "sales_executions"
      WHERE "id" = OLD."execution_id"
      FOR SHARE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
      IF quantity_correction IS NOT TRUE
        OR TG_OP <> 'UPDATE'
        OR (TO_JSONB(NEW) - 'quantity' - 'sales_amount')
           IS DISTINCT FROM (TO_JSONB(OLD) - 'quantity' - 'sales_amount') THEN
        RAISE EXCEPTION 'dispatched sales execution items are immutable';
      END IF;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status
      FROM "sales_executions"
      WHERE "id" = NEW."execution_id"
      FOR SHARE;
    IF new_parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
      IF quantity_correction IS NOT TRUE
        OR TG_OP <> 'UPDATE'
        OR (TO_JSONB(NEW) - 'quantity' - 'sales_amount')
           IS DISTINCT FROM (TO_JSONB(OLD) - 'quantity' - 'sales_amount') THEN
        RAISE EXCEPTION 'dispatched sales execution items are immutable';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "reject_locked_factory_purchase_order_item_mutation"() RETURNS trigger AS $$
DECLARE
  old_parent_status "FactoryPurchaseOrderStatus";
  new_parent_status "FactoryPurchaseOrderStatus";
  quantity_correction BOOLEAN := current_setting('app.sales_quantity_correction', true) = 'on';
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_parent_status
      FROM "factory_purchase_orders"
      WHERE "id" = OLD."purchase_order_id"
      FOR SHARE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      IF quantity_correction IS TRUE AND TG_OP = 'UPDATE' THEN
        IF (TO_JSONB(NEW) - 'allocated_quantity' - 'amount')
           IS DISTINCT FROM (TO_JSONB(OLD) - 'allocated_quantity' - 'amount') THEN
          RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
        END IF;
      ELSIF TG_OP <> 'UPDATE'
        OR (TO_JSONB(NEW) - 'actual_delivered_quantity')
           IS DISTINCT FROM (TO_JSONB(OLD) - 'actual_delivered_quantity') THEN
        RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
      END IF;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status
      FROM "factory_purchase_orders"
      WHERE "id" = NEW."purchase_order_id"
      FOR SHARE;
    IF new_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      IF quantity_correction IS TRUE AND TG_OP = 'UPDATE' THEN
        IF (TO_JSONB(NEW) - 'allocated_quantity' - 'amount')
           IS DISTINCT FROM (TO_JSONB(OLD) - 'allocated_quantity' - 'amount') THEN
          RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
        END IF;
      ELSIF TG_OP <> 'UPDATE'
        OR (TO_JSONB(NEW) - 'actual_delivered_quantity')
           IS DISTINCT FROM (TO_JSONB(OLD) - 'actual_delivered_quantity') THEN
        RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "reject_locked_sales_execution_core_mutation"() RETURNS trigger AS $$
DECLARE
  quantity_correction BOOLEAN := current_setting('app.sales_quantity_correction', true) = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'dispatched sales executions cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."execution_no" IS DISTINCT FROM OLD."execution_no"
    OR NEW."creation_key" IS DISTINCT FROM OLD."creation_key"
    OR NEW."execution_date" IS DISTINCT FROM OLD."execution_date"
    OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
    OR NEW."source_quotation_id" IS DISTINCT FROM OLD."source_quotation_id"
    OR NEW."source_quotation_version_id" IS DISTINCT FROM OLD."source_quotation_version_id"
    OR NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
    OR NEW."business_entity_id" IS DISTINCT FROM OLD."business_entity_id"
    OR NEW."salesperson_user_id" IS DISTINCT FROM OLD."salesperson_user_id"
    OR NEW."customer_name_snapshot" IS DISTINCT FROM OLD."customer_name_snapshot"
    OR NEW."customer_short_name_snapshot" IS DISTINCT FROM OLD."customer_short_name_snapshot"
    OR NEW."business_entity_name_snapshot" IS DISTINCT FROM OLD."business_entity_name_snapshot"
    OR NEW."business_entity_short_name_snapshot" IS DISTINCT FROM OLD."business_entity_short_name_snapshot"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."exchange_rate" IS DISTINCT FROM OLD."exchange_rate"
    OR NEW."trade_term" IS DISTINCT FROM OLD."trade_term"
    OR NEW."payment_term" IS DISTINCT FROM OLD."payment_term"
    OR NEW."customer_order_no" IS DISTINCT FROM OLD."customer_order_no"
    OR NEW."requested_delivery_date" IS DISTINCT FROM OLD."requested_delivery_date"
    OR (
      quantity_correction IS NOT TRUE
      AND (
        NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
        OR NEW."total_amount" IS DISTINCT FROM OLD."total_amount"
      )
    )
    OR NEW."remark" IS DISTINCT FROM OLD."remark"
    OR NEW."dispatched_at" IS DISTINCT FROM OLD."dispatched_at"
    OR NEW."dispatched_by" IS DISTINCT FROM OLD."dispatched_by"
    OR NEW."dispatched_version_number" IS DISTINCT FROM OLD."dispatched_version_number"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'dispatched sales execution core fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "reject_locked_factory_purchase_order_core_mutation"() RETURNS trigger AS $$
DECLARE
  quantity_correction BOOLEAN := current_setting('app.sales_quantity_correction', true) = 'on';
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
    OR (quantity_correction IS NOT TRUE AND NEW."subtotal" IS DISTINCT FROM OLD."subtotal")
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

CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_execution_anchors"() RETURNS trigger AS $$
DECLARE
  quantity_correction BOOLEAN := current_setting('app.sales_quantity_correction', true) = 'on';
BEGIN
  IF OLD."initial_supplier_delivery_date" IS NOT NULL
    AND NEW."initial_supplier_delivery_date" IS DISTINCT FROM OLD."initial_supplier_delivery_date" THEN
    RAISE EXCEPTION 'initial supplier delivery date is immutable';
  END IF;
  IF OLD."penalty_base_amount" IS NOT NULL
    AND NEW."penalty_base_amount" IS DISTINCT FROM OLD."penalty_base_amount"
    AND quantity_correction IS NOT TRUE THEN
    RAISE EXCEPTION 'factory purchase order penalty base is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "guard_factory_purchase_order_production_report_insert"() RETURNS trigger AS $$
DECLARE
  purchase_order_supplier_id TEXT;
  purchase_order_status TEXT;
  purchase_order_production_status TEXT;
  production_started_at TIMESTAMP(3);
  expected_sequence INTEGER;
  quantity_correction BOOLEAN := current_setting('app.sales_quantity_correction', true) = 'on';
BEGIN
  SELECT
    purchase_order."supplier_id",
    purchase_order."status"::TEXT,
    purchase_order."production_status"::TEXT,
    purchase_order."production_started_at"
  INTO
    purchase_order_supplier_id,
    purchase_order_status,
    purchase_order_production_status,
    production_started_at
  FROM "factory_purchase_orders" AS purchase_order
  WHERE purchase_order."id" = NEW."purchase_order_id";

  IF purchase_order_supplier_id IS NULL
    OR purchase_order_status <> 'ACCEPTED'
    OR (
      purchase_order_production_status <> 'IN_PRODUCTION'
      AND NOT (
        quantity_correction IS TRUE
        AND NEW."source" = 'INTERNAL_OFFLINE'
        AND purchase_order_production_status = 'COMPLETED'
      )
    ) THEN
    RAISE EXCEPTION 'production progress requires an accepted in-production purchase order';
  END IF;
  IF NEW."supplier_reported_at" < production_started_at
    OR NEW."supplier_reported_at" > NEW."reported_at"
    OR NEW."reported_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'production progress report time is invalid';
  END IF;
  IF NEW."source" = 'SUPPLIER_PORTAL' THEN
    IF NEW."channel" <> 'PORTAL' OR NOT EXISTS (
      SELECT 1
      FROM "users" AS reporter
      WHERE reporter."id" = NEW."reported_by"
        AND reporter."supplier_id" = purchase_order_supplier_id
        AND reporter."is_active" = TRUE
        AND reporter."approval_status" = 'APPROVED'
        AND reporter."deleted_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'production progress reporter is not an active operator for this supplier';
    END IF;
  ELSIF NEW."source" = 'INTERNAL_OFFLINE' THEN
    IF NEW."channel" = 'PORTAL' OR NOT EXISTS (
      SELECT 1
      FROM "users" AS reporter
      WHERE reporter."id" = NEW."reported_by"
        AND reporter."supplier_id" IS NULL
        AND reporter."is_active" = TRUE
        AND reporter."approval_status" = 'APPROVED'
        AND reporter."deleted_at" IS NULL
    ) THEN
      RAISE EXCEPTION 'offline production progress requires an active internal operator';
    END IF;
  ELSE
    RAISE EXCEPTION 'production progress source is invalid';
  END IF;
  SELECT COALESCE(MAX(report."sequence_no"), 0) + 1
  INTO expected_sequence
  FROM "factory_purchase_order_production_reports" AS report
  WHERE report."purchase_order_id" = NEW."purchase_order_id";
  IF NEW."sequence_no" <> expected_sequence THEN
    RAISE EXCEPTION 'production progress sequence is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
