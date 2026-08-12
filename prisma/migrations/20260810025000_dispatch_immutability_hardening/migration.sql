-- Check both the old and new parent on row moves. Checking NEW alone would let
-- a caller move a locked row from a dispatched document into a draft document.
CREATE OR REPLACE FUNCTION "reject_locked_sales_execution_item_mutation"() RETURNS trigger AS $$
DECLARE
  old_parent_status "SalesExecutionStatus";
  new_parent_status "SalesExecutionStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_parent_status FROM "sales_executions" WHERE "id" = OLD."execution_id";
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
      RAISE EXCEPTION 'dispatched sales execution items are immutable';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status FROM "sales_executions" WHERE "id" = NEW."execution_id";
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
    SELECT "status" INTO old_parent_status FROM "factory_purchase_orders" WHERE "id" = OLD."purchase_order_id";
    IF old_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_parent_status FROM "factory_purchase_orders" WHERE "id" = NEW."purchase_order_id";
    IF new_parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
      RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_factory_purchase_order_execution_parent"() RETURNS trigger AS $$
DECLARE
  parent_status "SalesExecutionStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "sales_executions" WHERE "id" = NEW."execution_id";
  IF parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
    RAISE EXCEPTION 'factory purchase orders can only be created or moved inside draft sales executions';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_orders_execution_parent_guard"
  BEFORE INSERT OR UPDATE OF "execution_id" ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_execution_parent"();

CREATE FUNCTION "validate_sales_execution_status_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'DISPATCHED', 'VOIDED') THEN
    RAISE EXCEPTION 'invalid draft sales execution transition';
  END IF;
  IF OLD."status" = 'DISPATCHED' AND NEW."status" NOT IN ('DISPATCHED', 'VOIDED') THEN
    RAISE EXCEPTION 'dispatched sales execution cannot return to draft';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    IF NEW."status" <> 'VOIDED' THEN
      RAISE EXCEPTION 'voided sales execution cannot be restored';
    END IF;
    IF NEW."voided_at" IS DISTINCT FROM OLD."voided_at"
      OR NEW."voided_by" IS DISTINCT FROM OLD."voided_by"
      OR NEW."void_reason" IS DISTINCT FROM OLD."void_reason" THEN
      RAISE EXCEPTION 'sales execution void audit fields are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_executions_status_transition_guard"
  BEFORE UPDATE ON "sales_executions"
  FOR EACH ROW EXECUTE FUNCTION "validate_sales_execution_status_transition"();

CREATE FUNCTION "protect_factory_purchase_order_void_audit"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'VOIDED' AND (
    NEW."voided_at" IS DISTINCT FROM OLD."voided_at"
    OR NEW."voided_by" IS DISTINCT FROM OLD."voided_by"
    OR NEW."void_reason" IS DISTINCT FROM OLD."void_reason"
  ) THEN
    RAISE EXCEPTION 'factory purchase order void audit fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_orders_void_audit_guard"
  BEFORE UPDATE ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_void_audit"();
