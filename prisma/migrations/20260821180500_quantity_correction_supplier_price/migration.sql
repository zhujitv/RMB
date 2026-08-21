-- Quantity correction may change the allocated quantity after a supplier has
-- confirmed a replacement unit price. Keep the confirmed price immutable, but
-- allow the audited quantity-correction transaction to recompute only the
-- derived amount from the current quantity and confirmed unit price.

CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_supplier_price"() RETURNS trigger AS $$
DECLARE
  quantity_correction BOOLEAN := current_setting('app.sales_quantity_correction', true) = 'on';
  allocated_quantity DECIMAL(18,4);
BEGIN
  IF TG_OP = 'UPDATE' AND quantity_correction IS TRUE THEN
    IF (TO_JSONB(NEW) - 'amount') IS DISTINCT FROM (TO_JSONB(OLD) - 'amount') THEN
      RAISE EXCEPTION 'confirmed supplier price is immutable';
    END IF;

    SELECT item."allocated_quantity"
    INTO allocated_quantity
    FROM "factory_purchase_order_items" AS item
    WHERE item."id" = NEW."purchase_order_item_id"
      AND item."purchase_order_id" = NEW."purchase_order_id"
    FOR KEY SHARE;

    IF allocated_quantity IS NULL THEN
      RAISE EXCEPTION 'supplier price references an invalid purchase-order item';
    END IF;
    IF NEW."amount" <> ROUND(allocated_quantity * NEW."unit_price", 2) THEN
      RAISE EXCEPTION 'supplier price amount must equal quantity multiplied by unit price';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'confirmed supplier price is immutable';
END;
$$ LANGUAGE plpgsql;
