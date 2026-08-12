BEGIN;

-- Supplier production completion is a supplier-authored business fact. Keep
-- historical completed rows untouched, validate only future transitions, and
-- freeze the completion fact once it has been recorded.
CREATE FUNCTION "protect_supplier_factory_purchase_order_completion"() RETURNS trigger AS $$
DECLARE
  completion_actor_valid BOOLEAN := false;
BEGIN
  IF OLD."production_status" = 'COMPLETED' THEN
    IF NEW."production_status" IS DISTINCT FROM OLD."production_status"
      OR NEW."production_completed_at" IS DISTINCT FROM OLD."production_completed_at"
      OR NEW."production_completed_by" IS DISTINCT FROM OLD."production_completed_by" THEN
      RAISE EXCEPTION 'completed factory purchase order production is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."production_status" = 'IN_PRODUCTION'
    AND NEW."production_status" NOT IN ('IN_PRODUCTION', 'COMPLETED') THEN
    RAISE EXCEPTION 'in-progress factory purchase order production cannot move backwards';
  END IF;

  IF NEW."production_status" IS DISTINCT FROM OLD."production_status"
    AND NEW."production_status" = 'IN_PRODUCTION'
    AND OLD."production_status" IS DISTINCT FROM 'READY' THEN
    RAISE EXCEPTION 'factory purchase order production may only start from ready';
  END IF;

  IF OLD."production_started_at" IS NOT NULL
    AND (
      NEW."production_started_at" IS DISTINCT FROM OLD."production_started_at"
      OR NEW."production_started_by" IS DISTINCT FROM OLD."production_started_by"
    ) THEN
    RAISE EXCEPTION 'factory purchase order production start audit is immutable';
  END IF;

  IF NEW."production_status" = 'COMPLETED' THEN
    IF OLD."production_status" IS DISTINCT FROM 'IN_PRODUCTION' THEN
      RAISE EXCEPTION 'factory purchase order production may only complete from in production';
    END IF;

    IF NEW."production_completed_at" IS NULL
      OR NEW."production_completed_at" < OLD."production_started_at" THEN
      RAISE EXCEPTION 'factory purchase order production completion time is invalid';
    END IF;

    SELECT TRUE
    INTO completion_actor_valid
    FROM "users" completion_user
    JOIN "suppliers" completion_supplier
      ON completion_supplier."id" = completion_user."supplier_id"
    WHERE completion_user."id" = NEW."production_completed_by"
      AND completion_user."supplier_id" = NEW."supplier_id"
      AND completion_user."role" IN ('产品供应商', '产品供应商账号', '工厂供应商账号')
      AND completion_user."is_active" = TRUE
      AND completion_user."approval_status" = 'APPROVED'
      AND completion_user."deleted_at" IS NULL
      AND completion_supplier."id" = NEW."supplier_id"
      AND completion_supplier."supplier_type" IN ('产品供应商', '工厂供应商', 'PRODUCT')
      AND completion_supplier."status" = '启用'
      AND completion_supplier."allow_factory_document_upload" = TRUE
      AND completion_supplier."deleted_at" IS NULL
    FOR SHARE OF completion_user, completion_supplier;

    IF COALESCE(completion_actor_valid, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'factory purchase order production completion requires an active approved supplier operator';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_orders_supplier_completion_guard"
  BEFORE UPDATE ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "protect_supplier_factory_purchase_order_completion"();

COMMIT;
