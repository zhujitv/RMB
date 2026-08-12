-- The dispatch boundary freezes the customer sale and every factory allocation.
-- Supplier replies are stored on the factory-facing purchase order only.

ALTER TYPE "SalesExecutionStatus" ADD VALUE 'DISPATCHED';
ALTER TYPE "FactoryPurchaseOrderStatus" ADD VALUE 'DISPATCHED';
ALTER TYPE "FactoryPurchaseOrderStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "FactoryPurchaseOrderStatus" ADD VALUE 'DELIVERY_PROPOSED';
ALTER TYPE "FactoryPurchaseOrderStatus" ADD VALUE 'REJECTED';

ALTER TABLE "sales_executions"
  ADD COLUMN "dispatched_at" TIMESTAMP(3),
  ADD COLUMN "dispatched_by" TEXT,
  ADD COLUMN "dispatched_version_number" INTEGER;

ALTER TABLE "factory_purchase_orders"
  ADD COLUMN "dispatched_at" TIMESTAMP(3),
  ADD COLUMN "dispatched_by" TEXT,
  ADD COLUMN "dispatch_version_number" INTEGER,
  ADD COLUMN "dispatch_email_status" TEXT,
  ADD COLUMN "dispatch_email_sent_at" TIMESTAMP(3),
  ADD COLUMN "dispatch_email_error" TEXT,
  ADD COLUMN "dispatch_recipient_emails" JSONB,
  ADD COLUMN "supplier_delivery_date" DATE,
  ADD COLUMN "supplier_response_remark" TEXT,
  ADD COLUMN "responded_at" TIMESTAMP(3),
  ADD COLUMN "responded_by" TEXT;

ALTER TABLE "sales_executions"
  DROP CONSTRAINT "sales_executions_void_state_check",
  ADD CONSTRAINT "sales_executions_dispatch_state_check" CHECK (
    (
      "dispatched_at" IS NULL
      AND "dispatched_by" IS NULL
      AND "dispatched_version_number" IS NULL
    )
    OR (
      "dispatched_at" IS NOT NULL
      AND "dispatched_by" IS NOT NULL
      AND "dispatched_version_number" > 0
    )
  ),
  ADD CONSTRAINT "sales_executions_lifecycle_state_check" CHECK (
    (
      "status" = 'DRAFT'
      AND "dispatched_at" IS NULL
      AND "voided_at" IS NULL
      AND "voided_by" IS NULL
      AND "void_reason" IS NULL
    )
    OR (
      "status" = 'DISPATCHED'
      AND "dispatched_at" IS NOT NULL
      AND "voided_at" IS NULL
      AND "voided_by" IS NULL
      AND "void_reason" IS NULL
    )
    OR (
      "status" = 'VOIDED'
      AND "voided_at" IS NOT NULL
      AND "voided_by" IS NOT NULL
      AND "void_reason" IS NOT NULL
    )
  );

ALTER TABLE "factory_purchase_orders"
  DROP CONSTRAINT "factory_purchase_orders_void_state_check",
  ADD CONSTRAINT "factory_purchase_orders_dispatch_state_check" CHECK (
    (
      "dispatched_at" IS NULL
      AND "dispatched_by" IS NULL
      AND "dispatch_version_number" IS NULL
    )
    OR (
      "dispatched_at" IS NOT NULL
      AND "dispatched_by" IS NOT NULL
      AND "dispatch_version_number" > 0
    )
  ),
  ADD CONSTRAINT "factory_purchase_orders_email_state_check" CHECK (
    "dispatch_email_status" IS NULL
    OR "dispatch_email_status" IN ('NOT_SENT', 'SENT', 'FAILED', 'NO_RECIPIENT')
  ),
  ADD CONSTRAINT "factory_purchase_orders_response_state_check" CHECK (
    (
      "status" IN ('DRAFT', 'DISPATCHED')
      AND "supplier_delivery_date" IS NULL
      AND "supplier_response_remark" IS NULL
      AND "responded_at" IS NULL
      AND "responded_by" IS NULL
    )
    OR (
      "status" = 'ACCEPTED'
      AND "supplier_delivery_date" IS NOT NULL
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    )
    OR (
      "status" = 'DELIVERY_PROPOSED'
      AND "supplier_delivery_date" IS NOT NULL
      AND NULLIF(BTRIM("supplier_response_remark"), '') IS NOT NULL
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    )
    OR (
      "status" = 'REJECTED'
      AND NULLIF(BTRIM("supplier_response_remark"), '') IS NOT NULL
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    )
    OR "status" = 'VOIDED'
  ),
  ADD CONSTRAINT "factory_purchase_orders_lifecycle_state_check" CHECK (
    (
      "status" = 'DRAFT'
      AND "dispatched_at" IS NULL
      AND "voided_at" IS NULL
      AND "voided_by" IS NULL
      AND "void_reason" IS NULL
    )
    OR (
      "status" IN ('DISPATCHED', 'ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED')
      AND "dispatched_at" IS NOT NULL
      AND "voided_at" IS NULL
      AND "voided_by" IS NULL
      AND "void_reason" IS NULL
    )
    OR (
      "status" = 'VOIDED'
      AND "voided_at" IS NOT NULL
      AND "voided_by" IS NOT NULL
      AND "void_reason" IS NOT NULL
    )
  );

CREATE INDEX "sales_executions_dispatched_by_idx"
  ON "sales_executions"("dispatched_by");
CREATE INDEX "factory_purchase_orders_dispatched_by_idx"
  ON "factory_purchase_orders"("dispatched_by");
CREATE INDEX "factory_purchase_orders_responded_by_idx"
  ON "factory_purchase_orders"("responded_by");

ALTER TABLE "sales_executions"
  ADD CONSTRAINT "sales_executions_dispatched_by_fkey"
  FOREIGN KEY ("dispatched_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_orders"
  ADD CONSTRAINT "factory_purchase_orders_dispatched_by_fkey"
  FOREIGN KEY ("dispatched_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_orders"
  ADD CONSTRAINT "factory_purchase_orders_responded_by_fkey"
  FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "reject_locked_sales_execution_item_mutation"() RETURNS trigger AS $$
DECLARE
  parent_status "SalesExecutionStatus";
  parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."execution_id" ELSE NEW."execution_id" END;
  SELECT "status" INTO parent_status FROM "sales_executions" WHERE "id" = parent_id;
  IF parent_status IS DISTINCT FROM 'DRAFT'::"SalesExecutionStatus" THEN
    RAISE EXCEPTION 'dispatched sales execution items are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_execution_items_dispatch_lock"
  BEFORE INSERT OR UPDATE OR DELETE ON "sales_execution_items"
  FOR EACH ROW EXECUTE FUNCTION "reject_locked_sales_execution_item_mutation"();

CREATE FUNCTION "reject_locked_factory_purchase_order_item_mutation"() RETURNS trigger AS $$
DECLARE
  parent_status "FactoryPurchaseOrderStatus";
  parent_id TEXT;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."purchase_order_id" ELSE NEW."purchase_order_id" END;
  SELECT "status" INTO parent_status FROM "factory_purchase_orders" WHERE "id" = parent_id;
  IF parent_status IS DISTINCT FROM 'DRAFT'::"FactoryPurchaseOrderStatus" THEN
    RAISE EXCEPTION 'dispatched factory purchase order items are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_items_dispatch_lock"
  BEFORE INSERT OR UPDATE OR DELETE ON "factory_purchase_order_items"
  FOR EACH ROW EXECUTE FUNCTION "reject_locked_factory_purchase_order_item_mutation"();

CREATE FUNCTION "reject_locked_sales_execution_core_mutation"() RETURNS trigger AS $$
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
    OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
    OR NEW."total_amount" IS DISTINCT FROM OLD."total_amount"
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

CREATE TRIGGER "sales_executions_dispatch_lock"
  BEFORE UPDATE OR DELETE ON "sales_executions"
  FOR EACH ROW EXECUTE FUNCTION "reject_locked_sales_execution_core_mutation"();

CREATE FUNCTION "reject_locked_factory_purchase_order_core_mutation"() RETURNS trigger AS $$
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

CREATE TRIGGER "factory_purchase_orders_dispatch_lock"
  BEFORE UPDATE OR DELETE ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "reject_locked_factory_purchase_order_core_mutation"();
