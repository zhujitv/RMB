-- Parent-row locks close the race between draft child edits and formal dispatch.
-- DELETE cascades are allowed when the already-deleting draft parent is no longer visible.
CREATE OR REPLACE FUNCTION "reject_locked_sales_execution_item_mutation"() RETURNS trigger AS $$
DECLARE
  old_parent_status "SalesExecutionStatus";
  new_parent_status "SalesExecutionStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_parent_status
      FROM "sales_executions"
      WHERE "id" = OLD."execution_id"
      FOR KEY SHARE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
      RAISE EXCEPTION 'dispatched sales execution items are immutable';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status
      FROM "sales_executions"
      WHERE "id" = NEW."execution_id"
      FOR KEY SHARE;
    IF new_parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
      RAISE EXCEPTION 'dispatched sales execution items are immutable';
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
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_parent_status
      FROM "factory_purchase_orders"
      WHERE "id" = OLD."purchase_order_id"
      FOR KEY SHARE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status
      FROM "factory_purchase_orders"
      WHERE "id" = NEW."purchase_order_id"
      FOR KEY SHARE;
    IF new_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_execution_parent"() RETURNS trigger AS $$
DECLARE
  parent_status "SalesExecutionStatus";
BEGIN
  SELECT "status" INTO parent_status
    FROM "sales_executions"
    WHERE "id" = NEW."execution_id"
    FOR KEY SHARE;
  IF parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
    RAISE EXCEPTION 'factory purchase orders can only be created or moved inside draft sales executions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A voided purchase order keeps the supplier's original response as audit evidence.
CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_status_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'DRAFT'
    AND NEW."status" NOT IN ('DRAFT', 'DISPATCHED', 'VOIDED') THEN
    RAISE EXCEPTION 'factory purchase order must be dispatched before supplier response';
  END IF;

  IF OLD."status" = 'DISPATCHED'
    AND NEW."status" NOT IN ('DISPATCHED', 'ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED', 'VOIDED') THEN
    RAISE EXCEPTION 'invalid dispatched factory purchase order transition';
  END IF;

  IF OLD."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED', 'VOIDED') THEN
    IF NEW."supplier_delivery_date" IS DISTINCT FROM OLD."supplier_delivery_date"
      OR NEW."supplier_response_remark" IS DISTINCT FROM OLD."supplier_response_remark"
      OR NEW."responded_at" IS DISTINCT FROM OLD."responded_at"
      OR NEW."responded_by" IS DISTINCT FROM OLD."responded_by" THEN
      RAISE EXCEPTION 'supplier response fields are immutable';
    END IF;
  END IF;

  IF OLD."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED')
    AND NEW."status" NOT IN (OLD."status", 'VOIDED') THEN
    RAISE EXCEPTION 'supplier response is immutable';
  END IF;

  IF OLD."status" = 'VOIDED' AND NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'voided factory purchase order cannot be restored';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
