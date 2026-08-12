-- Sales execution weights stay optional until packing data is known.
ALTER TABLE "sales_execution_items"
  ADD COLUMN "unit_net_weight_kg" DECIMAL(18,6);

ALTER TABLE "sales_execution_items"
  ADD CONSTRAINT "sales_execution_items_unit_net_weight_check"
  CHECK ("unit_net_weight_kg" IS NULL OR "unit_net_weight_kg" > 0);

-- A supplier may fill the purchase price later. Unknown prices and their
-- derived amounts/subtotals must remain NULL instead of being stored as zero.
ALTER TABLE "factory_purchase_order_items"
  ALTER COLUMN "purchase_unit_price" DROP NOT NULL,
  ALTER COLUMN "amount" DROP NOT NULL;

ALTER TABLE "factory_purchase_order_items"
  ADD CONSTRAINT "factory_purchase_order_items_price_amount_pair_check"
  CHECK (
    ("purchase_unit_price" IS NULL AND "amount" IS NULL)
    OR ("purchase_unit_price" IS NOT NULL AND "amount" IS NOT NULL)
  );

ALTER TABLE "factory_purchase_orders"
  ALTER COLUMN "subtotal" DROP NOT NULL;
