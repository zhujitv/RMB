ALTER TABLE "factory_purchase_transition_settlements"
  ADD COLUMN "revoked_at" TIMESTAMP(3),
  ADD COLUMN "revoked_by" TEXT,
  ADD COLUMN "revocation_reason" TEXT;

ALTER TABLE "factory_purchase_transition_settlements"
  ADD CONSTRAINT "factory_purchase_transition_settlements_revoked_by_fkey"
  FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS "factory_transition_settlement_immutable" ON "factory_purchase_transition_settlements";
DROP TRIGGER IF EXISTS "order_costs_factory_transition_guard" ON "order_costs";

DROP INDEX IF EXISTS "factory_purchase_transition_settlements_cost_id_key";
CREATE UNIQUE INDEX "factory_purchase_transition_settlements_active_cost_key"
  ON "factory_purchase_transition_settlements"("cost_id")
  WHERE "revoked_at" IS NULL;
CREATE INDEX "factory_purchase_transition_settlements_cost_revoked_idx"
  ON "factory_purchase_transition_settlements"("cost_id", "revoked_at");
CREATE INDEX "factory_purchase_transition_settlements_revoked_by_idx"
  ON "factory_purchase_transition_settlements"("revoked_by");

CREATE OR REPLACE FUNCTION prevent_factory_transition_settlement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."revoked_at" IS NULL
      AND OLD."revoked_by" IS NULL
      AND OLD."revocation_reason" IS NULL
      AND NEW."revoked_at" IS NOT NULL
      AND NEW."revoked_by" IS NOT NULL
      AND LENGTH(BTRIM(COALESCE(NEW."revocation_reason", ''))) >= 5
      AND NEW."id" IS NOT DISTINCT FROM OLD."id"
      AND NEW."cost_id" IS NOT DISTINCT FROM OLD."cost_id"
      AND NEW."order_id" IS NOT DISTINCT FROM OLD."order_id"
      AND NEW."supplier_id" IS NOT DISTINCT FROM OLD."supplier_id"
      AND NEW."customs_document_id" IS NOT DISTINCT FROM OLD."customs_document_id"
      AND NEW."goods_amount_with_tax" IS NOT DISTINCT FROM OLD."goods_amount_with_tax"
      AND NEW."increase_amount" IS NOT DISTINCT FROM OLD."increase_amount"
      AND NEW."decrease_amount" IS NOT DISTINCT FROM OLD."decrease_amount"
      AND NEW."final_payable_amount" IS NOT DISTINCT FROM OLD."final_payable_amount"
      AND NEW."currency" IS NOT DISTINCT FROM OLD."currency"
      AND NEW."item_snapshot" IS NOT DISTINCT FROM OLD."item_snapshot"
      AND NEW."customs_snapshot" IS NOT DISTINCT FROM OLD."customs_snapshot"
      AND NEW."reason" IS NOT DISTINCT FROM OLD."reason"
      AND NEW."confirmed_by" IS NOT DISTINCT FROM OLD."confirmed_by"
      AND NEW."confirmed_at" IS NOT DISTINCT FROM OLD."confirmed_at"
      AND NEW."created_at" IS NOT DISTINCT FROM OLD."created_at"
    THEN
      RETURN NEW;
    END IF;
  END IF;

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

  IF TG_OP = 'UPDATE'
    AND OLD."source_type" = 'FACTORY_PURCHASE_TRANSITION_SETTLEMENT'
    AND NEW."source_type" <> 'FACTORY_PURCHASE_TRANSITION_SETTLEMENT'
  THEN
    SELECT * INTO transition_record
    FROM "factory_purchase_transition_settlements"
    WHERE "id" = OLD."source_id"
      AND "cost_id" = OLD."id"
      AND "revoked_at" IS NOT NULL;

    IF FOUND
      AND NEW."source_type" IS NOT DISTINCT FROM 'MANUAL'
      AND NEW."source_id" IS NULL
      AND NEW."order_id" IS NOT DISTINCT FROM OLD."order_id"
      AND NEW."supplier_id" IS NOT DISTINCT FROM OLD."supplier_id"
      AND NEW."supplier_name_snapshot" IS NOT DISTINCT FROM OLD."supplier_name_snapshot"
      AND NEW."cost_type" IS NOT DISTINCT FROM OLD."cost_type"
      AND NEW."vendor_name" IS NOT DISTINCT FROM OLD."vendor_name"
      AND NEW."currency" IS NOT DISTINCT FROM OLD."currency"
      AND NEW."amount" IS NOT DISTINCT FROM OLD."amount"
      AND NEW."amount_cny" IS NOT DISTINCT FROM OLD."amount_cny"
      AND NEW."exchange_rate" IS NOT DISTINCT FROM OLD."exchange_rate"
      AND NEW."exchange_rate_date" IS NOT DISTINCT FROM OLD."exchange_rate_date"
      AND NEW."exchange_rate_source" IS NOT DISTINCT FROM OLD."exchange_rate_source"
      AND NEW."exchange_rate_type" IS NOT DISTINCT FROM OLD."exchange_rate_type"
      AND NEW."status" IS NOT DISTINCT FROM OLD."status"
      AND NEW."deleted_at" IS NOT DISTINCT FROM OLD."deleted_at"
      AND NEW."cost_confirmed" IS NOT DISTINCT FROM OLD."cost_confirmed"
      AND NEW."cost_confirmed_at" IS NOT DISTINCT FROM OLD."cost_confirmed_at"
      AND NEW."created_by" IS NOT DISTINCT FROM OLD."created_by"
      AND NEW."created_at" IS NOT DISTINCT FROM OLD."created_at"
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'factory transition settlement cost source is immutable';
  END IF;

  IF NEW."source_type" <> 'FACTORY_PURCHASE_TRANSITION_SETTLEMENT' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO transition_record
  FROM "factory_purchase_transition_settlements"
  WHERE "id" = NEW."source_id"
    AND "cost_id" = NEW."id"
    AND "revoked_at" IS NULL;

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
