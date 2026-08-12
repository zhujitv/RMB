BEGIN;

CREATE TYPE "SalesExecutionSourceType" AS ENUM ('QUOTATION', 'DIRECT');
CREATE TYPE "SalesExecutionStatus" AS ENUM ('DRAFT', 'VOIDED');
CREATE TYPE "FactoryPurchaseOrderStatus" AS ENUM ('DRAFT', 'VOIDED');

CREATE TABLE "sales_execution_number_sequences" (
  "execution_date" DATE NOT NULL,
  "last_sequence" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_execution_number_sequences_pkey" PRIMARY KEY ("execution_date"),
  CONSTRAINT "sales_execution_number_sequences_value_check" CHECK ("last_sequence" > 0)
);

CREATE TABLE "sales_executions" (
  "id" TEXT NOT NULL,
  "execution_no" TEXT NOT NULL,
  "creation_key" TEXT,
  "execution_date" DATE NOT NULL,
  "source_type" "SalesExecutionSourceType" NOT NULL,
  "source_quotation_id" TEXT,
  "source_quotation_version_id" TEXT,
  "customer_id" TEXT NOT NULL,
  "business_entity_id" TEXT NOT NULL,
  "salesperson_user_id" TEXT NOT NULL,
  "customer_name_snapshot" TEXT NOT NULL,
  "customer_short_name_snapshot" TEXT,
  "business_entity_name_snapshot" TEXT NOT NULL,
  "business_entity_short_name_snapshot" TEXT,
  "currency" TEXT NOT NULL,
  "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "trade_term" TEXT,
  "payment_term" TEXT,
  "customer_order_no" TEXT,
  "requested_delivery_date" DATE,
  "subtotal" DECIMAL(18,2) NOT NULL,
  "total_amount" DECIMAL(18,2) NOT NULL,
  "status" "SalesExecutionStatus" NOT NULL DEFAULT 'DRAFT',
  "current_version_number" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "remark" TEXT,
  "voided_at" TIMESTAMP(3),
  "voided_by" TEXT,
  "void_reason" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_executions_source_check" CHECK (
    ("source_type" = 'QUOTATION' AND "source_quotation_id" IS NOT NULL AND "source_quotation_version_id" IS NOT NULL)
    OR ("source_type" = 'DIRECT' AND "source_quotation_id" IS NULL AND "source_quotation_version_id" IS NULL)
  ),
  CONSTRAINT "sales_executions_version_check" CHECK ("current_version_number" > 0 AND "revision" > 0),
  CONSTRAINT "sales_executions_money_check" CHECK (
    "exchange_rate" > 0 AND "subtotal" >= 0 AND "total_amount" >= 0
  ),
  CONSTRAINT "sales_executions_void_state_check" CHECK (
    ("status" = 'DRAFT' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
    OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)
  )
);

CREATE TABLE "sales_execution_items" (
  "id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "line_number" INTEGER NOT NULL,
  "source_quotation_item_id" TEXT,
  "source_quotation_version_id" TEXT,
  "customer_product_id" TEXT,
  "product_fingerprint_snapshot" TEXT NOT NULL,
  "product_name_snapshot" TEXT NOT NULL,
  "specification_snapshot" TEXT,
  "unit_snapshot" TEXT NOT NULL,
  "currency_snapshot" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "sales_unit_price" DECIMAL(18,6) NOT NULL,
  "sales_amount" DECIMAL(18,2) NOT NULL,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_execution_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_execution_items_line_check" CHECK ("line_number" > 0),
  CONSTRAINT "sales_execution_items_money_check" CHECK (
    "quantity" > 0 AND "sales_unit_price" >= 0 AND "sales_amount" >= 0
  )
);

CREATE TABLE "sales_execution_versions" (
  "id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_execution_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_execution_versions_number_check" CHECK ("version_number" > 0)
);

CREATE TABLE "factory_purchase_orders" (
  "id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "po_no" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "supplier_name_snapshot" TEXT NOT NULL,
  "status" "FactoryPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "purchase_currency" TEXT NOT NULL,
  "subtotal" DECIMAL(18,2) NOT NULL,
  "requested_delivery_date" DATE,
  "payment_term" TEXT,
  "remark" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "voided_at" TIMESTAMP(3),
  "voided_by" TEXT,
  "void_reason" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "factory_purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "factory_purchase_orders_sequence_check" CHECK ("sequence_no" > 0 AND "revision" > 0),
  CONSTRAINT "factory_purchase_orders_money_check" CHECK ("subtotal" >= 0),
  CONSTRAINT "factory_purchase_orders_void_state_check" CHECK (
    ("status" = 'DRAFT' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
    OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)
  )
);

CREATE TABLE "factory_purchase_order_items" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "execution_item_id" TEXT NOT NULL,
  "line_number" INTEGER NOT NULL,
  "product_name_snapshot" TEXT NOT NULL,
  "specification_snapshot" TEXT,
  "unit_snapshot" TEXT NOT NULL,
  "allocated_quantity" DECIMAL(18,4) NOT NULL,
  "purchase_unit_price" DECIMAL(18,6) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "factory_purchase_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "factory_purchase_order_items_line_check" CHECK ("line_number" > 0),
  CONSTRAINT "factory_purchase_order_items_money_check" CHECK (
    "allocated_quantity" > 0 AND "purchase_unit_price" >= 0 AND "amount" >= 0
  )
);

CREATE UNIQUE INDEX "sales_executions_execution_no_key" ON "sales_executions"("execution_no");
CREATE UNIQUE INDEX "sales_executions_creation_key_key" ON "sales_executions"("creation_key");
CREATE UNIQUE INDEX "sales_executions_source_quotation_id_key" ON "sales_executions"("source_quotation_id");
CREATE UNIQUE INDEX "sales_executions_source_quotation_version_id_key" ON "sales_executions"("source_quotation_version_id");
CREATE UNIQUE INDEX "sales_executions_source_quotation_version_id_source_quotation_id_key"
  ON "sales_executions"("source_quotation_version_id", "source_quotation_id");
CREATE INDEX "sales_executions_customer_id_status_updated_at_idx" ON "sales_executions"("customer_id", "status", "updated_at");
CREATE INDEX "sales_executions_business_entity_id_idx" ON "sales_executions"("business_entity_id");
CREATE INDEX "sales_executions_salesperson_user_id_status_updated_at_idx" ON "sales_executions"("salesperson_user_id", "status", "updated_at");
CREATE INDEX "sales_executions_status_updated_at_idx" ON "sales_executions"("status", "updated_at");
CREATE INDEX "sales_executions_voided_by_idx" ON "sales_executions"("voided_by");
CREATE INDEX "sales_executions_created_by_idx" ON "sales_executions"("created_by");
CREATE INDEX "sales_executions_updated_by_idx" ON "sales_executions"("updated_by");

CREATE UNIQUE INDEX "sales_execution_items_execution_id_line_number_key" ON "sales_execution_items"("execution_id", "line_number");
CREATE UNIQUE INDEX "sales_execution_items_id_execution_id_key" ON "sales_execution_items"("id", "execution_id");
CREATE UNIQUE INDEX "sales_execution_items_execution_id_source_quotation_item_id_key"
  ON "sales_execution_items"("execution_id", "source_quotation_item_id");
CREATE INDEX "sales_execution_items_source_quotation_version_id_idx" ON "sales_execution_items"("source_quotation_version_id");
CREATE INDEX "sales_execution_items_customer_product_id_idx" ON "sales_execution_items"("customer_product_id");
CREATE INDEX "sales_execution_items_product_fingerprint_snapshot_idx" ON "sales_execution_items"("product_fingerprint_snapshot");

CREATE UNIQUE INDEX "sales_execution_versions_execution_id_version_number_key" ON "sales_execution_versions"("execution_id", "version_number");
CREATE INDEX "sales_execution_versions_created_by_idx" ON "sales_execution_versions"("created_by");

CREATE UNIQUE INDEX "factory_purchase_orders_po_no_key" ON "factory_purchase_orders"("po_no");
CREATE UNIQUE INDEX "factory_purchase_orders_execution_id_sequence_no_key" ON "factory_purchase_orders"("execution_id", "sequence_no");
CREATE UNIQUE INDEX "factory_purchase_orders_execution_id_supplier_id_purchase_currency_key"
  ON "factory_purchase_orders"("execution_id", "supplier_id", "purchase_currency");
CREATE UNIQUE INDEX "factory_purchase_orders_id_execution_id_key" ON "factory_purchase_orders"("id", "execution_id");
CREATE INDEX "factory_purchase_orders_supplier_id_status_updated_at_idx" ON "factory_purchase_orders"("supplier_id", "status", "updated_at");
CREATE INDEX "factory_purchase_orders_voided_by_idx" ON "factory_purchase_orders"("voided_by");
CREATE INDEX "factory_purchase_orders_created_by_idx" ON "factory_purchase_orders"("created_by");
CREATE INDEX "factory_purchase_orders_updated_by_idx" ON "factory_purchase_orders"("updated_by");

CREATE UNIQUE INDEX "factory_purchase_order_items_purchase_order_id_execution_item_id_key"
  ON "factory_purchase_order_items"("purchase_order_id", "execution_item_id");
CREATE UNIQUE INDEX "factory_purchase_order_items_purchase_order_id_line_number_key"
  ON "factory_purchase_order_items"("purchase_order_id", "line_number");
CREATE INDEX "factory_purchase_order_items_execution_item_id_execution_id_idx"
  ON "factory_purchase_order_items"("execution_item_id", "execution_id");

CREATE UNIQUE INDEX "sales_quotation_items_id_quotation_version_id_key"
  ON "sales_quotation_items"("id", "quotation_version_id");

ALTER TABLE "sales_executions" ADD CONSTRAINT "sales_executions_source_quotation_id_fkey"
  FOREIGN KEY ("source_quotation_id") REFERENCES "sales_quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_executions" ADD CONSTRAINT "sales_executions_source_quotation_version_id_source_quotation_id_fkey"
  FOREIGN KEY ("source_quotation_version_id", "source_quotation_id")
  REFERENCES "sales_quotation_versions"("id", "quotation_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_executions" ADD CONSTRAINT "sales_executions_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_executions" ADD CONSTRAINT "sales_executions_business_entity_id_fkey"
  FOREIGN KEY ("business_entity_id") REFERENCES "business_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_executions" ADD CONSTRAINT "sales_executions_salesperson_user_id_fkey"
  FOREIGN KEY ("salesperson_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_executions" ADD CONSTRAINT "sales_executions_voided_by_fkey"
  FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_executions" ADD CONSTRAINT "sales_executions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_executions" ADD CONSTRAINT "sales_executions_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_execution_items" ADD CONSTRAINT "sales_execution_items_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "sales_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_execution_items" ADD CONSTRAINT "sales_execution_items_source_quotation_item_id_fkey"
  FOREIGN KEY ("source_quotation_item_id", "source_quotation_version_id")
  REFERENCES "sales_quotation_items"("id", "quotation_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_execution_items" ADD CONSTRAINT "sales_execution_items_customer_product_id_fkey"
  FOREIGN KEY ("customer_product_id") REFERENCES "customer_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_execution_versions" ADD CONSTRAINT "sales_execution_versions_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "sales_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_execution_versions" ADD CONSTRAINT "sales_execution_versions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_orders" ADD CONSTRAINT "factory_purchase_orders_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "sales_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_orders" ADD CONSTRAINT "factory_purchase_orders_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_orders" ADD CONSTRAINT "factory_purchase_orders_voided_by_fkey"
  FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_orders" ADD CONSTRAINT "factory_purchase_orders_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_orders" ADD CONSTRAINT "factory_purchase_orders_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_items" ADD CONSTRAINT "factory_purchase_order_items_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id", "execution_id")
  REFERENCES "factory_purchase_orders"("id", "execution_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_order_items" ADD CONSTRAINT "factory_purchase_order_items_execution_item_id_fkey"
  FOREIGN KEY ("execution_item_id", "execution_id")
  REFERENCES "sales_execution_items"("id", "execution_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_sales_execution_item_source"() RETURNS trigger AS $$
DECLARE
  execution_source "SalesExecutionSourceType";
  execution_source_version_id TEXT;
BEGIN
  SELECT "source_type", "source_quotation_version_id"
    INTO execution_source, execution_source_version_id
  FROM "sales_executions"
  WHERE "id" = NEW."execution_id";

  IF execution_source = 'DIRECT' THEN
    IF NEW."source_quotation_item_id" IS NOT NULL OR NEW."source_quotation_version_id" IS NOT NULL THEN
      RAISE EXCEPTION 'direct sales execution items cannot reference quotation snapshots';
    END IF;
  ELSIF execution_source = 'QUOTATION' THEN
    IF NEW."source_quotation_item_id" IS NULL
      OR NEW."source_quotation_version_id" IS NULL
      OR NEW."source_quotation_version_id" IS DISTINCT FROM execution_source_version_id THEN
      RAISE EXCEPTION 'quotation sales execution items must match the execution source version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_execution_items_source_guard"
  BEFORE INSERT OR UPDATE ON "sales_execution_items"
  FOR EACH ROW EXECUTE FUNCTION "validate_sales_execution_item_source"();

CREATE FUNCTION "reject_sales_execution_source_mutation"() RETURNS trigger AS $$
BEGIN
  IF NEW."source_type" IS DISTINCT FROM OLD."source_type"
    OR NEW."source_quotation_id" IS DISTINCT FROM OLD."source_quotation_id"
    OR NEW."source_quotation_version_id" IS DISTINCT FROM OLD."source_quotation_version_id" THEN
    RAISE EXCEPTION 'sales execution source is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_executions_source_immutable"
  BEFORE UPDATE OF "source_type", "source_quotation_id", "source_quotation_version_id"
  ON "sales_executions"
  FOR EACH ROW EXECUTE FUNCTION "reject_sales_execution_source_mutation"();

CREATE FUNCTION "reject_sales_execution_version_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sales execution version snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_execution_versions_immutable"
  BEFORE UPDATE OR DELETE ON "sales_execution_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_sales_execution_version_mutation"();

COMMIT;
