CREATE TABLE "factory_purchase_transition_settlements" (
  "id" TEXT NOT NULL,
  "cost_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "customs_document_id" TEXT NOT NULL,
  "goods_amount_with_tax" DECIMAL(18,2) NOT NULL,
  "increase_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "decrease_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "final_payable_amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "item_snapshot" JSONB NOT NULL,
  "customs_snapshot" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "confirmed_by" TEXT NOT NULL,
  "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "factory_purchase_transition_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "factory_transition_amounts_check" CHECK (
    "goods_amount_with_tax" > 0
    AND "increase_amount" >= 0
    AND "decrease_amount" >= 0
    AND "final_payable_amount" = "goods_amount_with_tax" + "increase_amount" - "decrease_amount"
    AND "final_payable_amount" >= 0
  ),
  CONSTRAINT "factory_transition_reason_check" CHECK (LENGTH(BTRIM("reason")) >= 5)
);

CREATE UNIQUE INDEX "factory_purchase_transition_settlements_cost_id_key"
  ON "factory_purchase_transition_settlements"("cost_id");
CREATE INDEX "factory_purchase_transition_settlements_order_id_supplier_id_idx"
  ON "factory_purchase_transition_settlements"("order_id", "supplier_id");
CREATE INDEX "factory_purchase_transition_settlements_customs_document_id_idx"
  ON "factory_purchase_transition_settlements"("customs_document_id");
CREATE INDEX "factory_purchase_transition_settlements_confirmed_by_idx"
  ON "factory_purchase_transition_settlements"("confirmed_by");

ALTER TABLE "factory_purchase_transition_settlements"
  ADD CONSTRAINT "factory_purchase_transition_settlements_cost_id_fkey"
  FOREIGN KEY ("cost_id") REFERENCES "order_costs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_transition_settlements"
  ADD CONSTRAINT "factory_purchase_transition_settlements_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_transition_settlements"
  ADD CONSTRAINT "factory_purchase_transition_settlements_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_transition_settlements"
  ADD CONSTRAINT "factory_purchase_transition_settlements_customs_document_id_fkey"
  FOREIGN KEY ("customs_document_id") REFERENCES "order_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "factory_purchase_transition_settlements"
  ADD CONSTRAINT "factory_purchase_transition_settlements_confirmed_by_fkey"
  FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_factory_transition_settlement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'confirmed factory transition settlement is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_transition_settlement_immutable"
BEFORE UPDATE OR DELETE ON "factory_purchase_transition_settlements"
FOR EACH ROW EXECUTE FUNCTION prevent_factory_transition_settlement_mutation();

CREATE OR REPLACE FUNCTION guard_factory_transition_cost()
RETURNS TRIGGER AS $$
DECLARE
  transition_record RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."source_type" = 'FACTORY_PURCHASE_TRANSITION_SETTLEMENT' THEN
      RAISE EXCEPTION 'factory transition settlement cost cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."source_type" <> 'FACTORY_PURCHASE_TRANSITION_SETTLEMENT' THEN
    IF TG_OP = 'UPDATE' AND OLD."source_type" = 'FACTORY_PURCHASE_TRANSITION_SETTLEMENT' THEN
      RAISE EXCEPTION 'factory transition settlement cost source is immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO transition_record
  FROM "factory_purchase_transition_settlements"
  WHERE "id" = NEW."source_id" AND "cost_id" = NEW."id";

  IF NOT FOUND
    OR NEW."order_id" IS DISTINCT FROM transition_record."order_id"
    OR NEW."supplier_id" IS DISTINCT FROM transition_record."supplier_id"
    OR NEW."amount" IS DISTINCT FROM transition_record."final_payable_amount"
    OR NEW."amount_cny" IS DISTINCT FROM transition_record."final_payable_amount"
    OR NEW."exchange_rate" IS DISTINCT FROM 1
    OR NEW."cost_type" NOT IN ('工厂货款', '原材料货款', '采购货款', '产品货款')
    OR NEW."currency" IS DISTINCT FROM transition_record."currency"
    OR NEW."status" IS DISTINCT FROM 'ACTIVE'
    OR NEW."deleted_at" IS NOT NULL
    OR NEW."cost_confirmed" IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION 'factory transition settlement cost does not match its confirmed source';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."source_type" = 'FACTORY_PURCHASE_TRANSITION_SETTLEMENT' AND (
    NEW."order_id" IS DISTINCT FROM OLD."order_id"
    OR NEW."supplier_id" IS DISTINCT FROM OLD."supplier_id"
    OR NEW."supplier_name_snapshot" IS DISTINCT FROM OLD."supplier_name_snapshot"
    OR NEW."cost_type" IS DISTINCT FROM OLD."cost_type"
    OR NEW."vendor_name" IS DISTINCT FROM OLD."vendor_name"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."amount_cny" IS DISTINCT FROM OLD."amount_cny"
    OR NEW."exchange_rate" IS DISTINCT FROM OLD."exchange_rate"
    OR NEW."exchange_rate_date" IS DISTINCT FROM OLD."exchange_rate_date"
    OR NEW."exchange_rate_source" IS DISTINCT FROM OLD."exchange_rate_source"
    OR NEW."exchange_rate_type" IS DISTINCT FROM OLD."exchange_rate_type"
    OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
    OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
    OR NEW."cost_confirmed" IS DISTINCT FROM OLD."cost_confirmed"
    OR NEW."cost_confirmed_at" IS DISTINCT FROM OLD."cost_confirmed_at"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."remark" IS DISTINCT FROM OLD."remark"
  ) THEN
    RAISE EXCEPTION 'factory transition settlement cost financial fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "order_costs_factory_transition_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "order_costs"
FOR EACH ROW EXECUTE FUNCTION guard_factory_transition_cost();
