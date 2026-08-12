-- A supplier response is a one-time business decision. It may later be voided,
-- but it cannot be rewritten or moved back to the pending state.
CREATE FUNCTION "validate_factory_purchase_order_status_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'DRAFT'
    AND NEW."status" NOT IN ('DRAFT', 'DISPATCHED', 'VOIDED') THEN
    RAISE EXCEPTION 'factory purchase order must be dispatched before supplier response';
  END IF;

  IF OLD."status" = 'DISPATCHED'
    AND NEW."status" NOT IN ('DISPATCHED', 'ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED', 'VOIDED') THEN
    RAISE EXCEPTION 'invalid dispatched factory purchase order transition';
  END IF;

  IF OLD."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED') THEN
    IF NEW."status" NOT IN (OLD."status", 'VOIDED') THEN
      RAISE EXCEPTION 'supplier response is immutable';
    END IF;
    IF NEW."supplier_delivery_date" IS DISTINCT FROM OLD."supplier_delivery_date"
      OR NEW."supplier_response_remark" IS DISTINCT FROM OLD."supplier_response_remark"
      OR NEW."responded_at" IS DISTINCT FROM OLD."responded_at"
      OR NEW."responded_by" IS DISTINCT FROM OLD."responded_by" THEN
      RAISE EXCEPTION 'supplier response fields are immutable';
    END IF;
  END IF;

  IF OLD."status" = 'VOIDED' AND NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'voided factory purchase order cannot be restored';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_orders_status_transition_guard"
  BEFORE UPDATE ON "factory_purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_status_transition"();
