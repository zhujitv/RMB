ALTER TABLE "customer_products"
  ADD COLUMN "material_code" TEXT;

CREATE INDEX "customer_products_customer_id_material_code_idx"
  ON "customer_products"("customer_id", "material_code");
