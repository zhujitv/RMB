BEGIN;

ALTER TABLE "sales_executions"
  ADD COLUMN "shipping_started_at" TIMESTAMP(3),
  ADD COLUMN "shipping_started_by" TEXT,
  ADD CONSTRAINT "sales_executions_shipping_started_pair_check"
    CHECK (("shipping_started_at" IS NULL) = ("shipping_started_by" IS NULL));

ALTER TABLE "receivable_orders"
  ADD COLUMN "source_sales_execution_id" TEXT,
  ADD CONSTRAINT "receivable_orders_source_not_deleted_check"
    CHECK ("source_sales_execution_id" IS NULL OR "deleted_at" IS NULL);

CREATE UNIQUE INDEX "receivable_orders_source_sales_execution_id_key"
  ON "receivable_orders"("source_sales_execution_id");
CREATE INDEX "sales_executions_shipping_started_by_idx"
  ON "sales_executions"("shipping_started_by");

ALTER TABLE "sales_executions"
  ADD CONSTRAINT "sales_executions_shipping_started_by_fkey"
    FOREIGN KEY ("shipping_started_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receivable_orders"
  ADD CONSTRAINT "receivable_orders_source_sales_execution_id_fkey"
    FOREIGN KEY ("source_sales_execution_id") REFERENCES "sales_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "protect_sales_execution_shipping_anchor"() RETURNS trigger AS $$
BEGIN
  IF OLD."shipping_started_at" IS NOT NULL AND (
    NEW."shipping_started_at" IS DISTINCT FROM OLD."shipping_started_at"
    OR NEW."shipping_started_by" IS DISTINCT FROM OLD."shipping_started_by"
    OR NEW."status" IS DISTINCT FROM OLD."status"
  ) THEN
    RAISE EXCEPTION 'sales execution shipping handoff is immutable';
  END IF;
  IF OLD."shipping_started_at" IS NULL
    AND NEW."shipping_started_at" IS NOT NULL
    AND NEW."status" <> 'DISPATCHED'::"SalesExecutionStatus" THEN
    RAISE EXCEPTION 'only dispatched sales executions may enter shipping';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_executions_shipping_anchor_guard"
  BEFORE UPDATE ON "sales_executions"
  FOR EACH ROW EXECUTE FUNCTION "protect_sales_execution_shipping_anchor"();

CREATE FUNCTION "protect_receivable_order_sales_execution_source"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."source_sales_execution_id" IS NOT NULL THEN
    RAISE EXCEPTION 'sales execution generated receivable orders cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."source_sales_execution_id" IS NOT NULL
    AND NEW."source_sales_execution_id" IS DISTINCT FROM OLD."source_sales_execution_id" THEN
    RAISE EXCEPTION 'receivable order sales execution source is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."source_sales_execution_id" IS NOT NULL
    AND NEW."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'sales execution generated receivable orders cannot be soft deleted';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "receivable_orders_sales_execution_source_guard"
  BEFORE UPDATE OR DELETE ON "receivable_orders"
  FOR EACH ROW EXECUTE FUNCTION "protect_receivable_order_sales_execution_source"();

COMMIT;
