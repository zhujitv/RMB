-- FOR SHARE conflicts with status updates (FOR NO KEY UPDATE); FOR KEY SHARE does not.
-- This makes the trigger itself a final concurrency boundary for every write path.
CREATE OR REPLACE FUNCTION "reject_locked_sales_execution_item_mutation"() RETURNS trigger AS $$
DECLARE
  old_parent_status "SalesExecutionStatus";
  new_parent_status "SalesExecutionStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_parent_status
      FROM "sales_executions"
      WHERE "id" = OLD."execution_id"
      FOR SHARE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
      RAISE EXCEPTION 'dispatched sales execution items are immutable';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status
      FROM "sales_executions"
      WHERE "id" = NEW."execution_id"
      FOR SHARE;
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
      FOR SHARE;
    IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status
      FROM "factory_purchase_orders"
      WHERE "id" = NEW."purchase_order_id"
      FOR SHARE;
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
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
    RAISE EXCEPTION 'factory purchase orders must start as drafts';
  END IF;
  SELECT "status" INTO parent_status
    FROM "sales_executions"
    WHERE "id" = NEW."execution_id"
    FOR SHARE;
  IF parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
    RAISE EXCEPTION 'factory purchase orders can only be created or moved inside draft sales executions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "factory_purchase_orders"
  DROP CONSTRAINT "factory_purchase_orders_email_state_check",
  ADD CONSTRAINT "factory_purchase_orders_email_state_check" CHECK (
    "dispatch_email_status" IS NULL
    OR "dispatch_email_status" IN ('NOT_SENT', 'SENDING', 'SENT', 'FAILED', 'NO_RECIPIENT')
  );
