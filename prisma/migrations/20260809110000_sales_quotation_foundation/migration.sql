BEGIN;

CREATE TYPE "SalesQuotationStatus" AS ENUM ('DRAFT', 'VOIDED');

CREATE TABLE "customer_products" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "specification" TEXT,
  "unit" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "remark" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_quotations" (
  "id" TEXT NOT NULL,
  "quote_no" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "salesperson_user_id" TEXT,
  "status" "SalesQuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "current_version_number" INTEGER NOT NULL DEFAULT 1,
  "voided_at" TIMESTAMP(3),
  "voided_by" TEXT,
  "void_reason" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_quotation_versions" (
  "id" TEXT NOT NULL,
  "quotation_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "customer_name_snapshot" TEXT NOT NULL,
  "customer_short_name_snapshot" TEXT,
  "country_snapshot" TEXT,
  "contact_person_snapshot" TEXT,
  "contact_email_snapshot" TEXT,
  "contact_phone_snapshot" TEXT,
  "quote_date" DATE NOT NULL,
  "valid_until" DATE,
  "currency" TEXT NOT NULL,
  "exchange_rate" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "subtotal" DECIMAL(18,2) NOT NULL,
  "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(18,2) NOT NULL,
  "trade_term" TEXT,
  "payment_term" TEXT,
  "lead_time_days" INTEGER,
  "remark" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sealed_at" TIMESTAMP(3),
  CONSTRAINT "sales_quotation_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_quotation_versions_version_number_check" CHECK ("version_number" > 0),
  CONSTRAINT "sales_quotation_versions_exchange_rate_check" CHECK ("exchange_rate" > 0),
  CONSTRAINT "sales_quotation_versions_money_check" CHECK (
    "subtotal" >= 0 AND "discount_amount" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0
  ),
  CONSTRAINT "sales_quotation_versions_lead_time_check" CHECK ("lead_time_days" IS NULL OR "lead_time_days" >= 0)
);

CREATE TABLE "sales_quotation_items" (
  "id" TEXT NOT NULL,
  "quotation_version_id" TEXT NOT NULL,
  "line_number" INTEGER NOT NULL,
  "customer_product_id" TEXT,
  "product_fingerprint_snapshot" TEXT NOT NULL,
  "product_name_snapshot" TEXT NOT NULL,
  "specification_snapshot" TEXT,
  "unit_snapshot" TEXT NOT NULL,
  "currency_snapshot" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unit_price" DECIMAL(18,6) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_quotation_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_quotation_items_line_number_check" CHECK ("line_number" > 0),
  CONSTRAINT "sales_quotation_items_amount_check" CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "amount" >= 0)
);

CREATE UNIQUE INDEX "customer_products_customer_id_fingerprint_key"
  ON "customer_products"("customer_id", "fingerprint");
CREATE INDEX "customer_products_customer_id_deleted_at_updated_at_idx"
  ON "customer_products"("customer_id", "deleted_at", "updated_at");
CREATE INDEX "customer_products_name_idx" ON "customer_products"("name");
CREATE INDEX "customer_products_created_by_idx" ON "customer_products"("created_by");
CREATE INDEX "customer_products_updated_by_idx" ON "customer_products"("updated_by");

CREATE UNIQUE INDEX "sales_quotations_quote_no_key" ON "sales_quotations"("quote_no");
CREATE INDEX "sales_quotations_customer_id_status_updated_at_idx"
  ON "sales_quotations"("customer_id", "status", "updated_at");
CREATE INDEX "sales_quotations_salesperson_user_id_idx" ON "sales_quotations"("salesperson_user_id");
CREATE INDEX "sales_quotations_status_updated_at_idx" ON "sales_quotations"("status", "updated_at");
CREATE INDEX "sales_quotations_voided_by_idx" ON "sales_quotations"("voided_by");
CREATE INDEX "sales_quotations_created_by_idx" ON "sales_quotations"("created_by");
CREATE INDEX "sales_quotations_updated_by_idx" ON "sales_quotations"("updated_by");

CREATE UNIQUE INDEX "sales_quotation_versions_quotation_id_version_number_key"
  ON "sales_quotation_versions"("quotation_id", "version_number");
CREATE INDEX "sales_quotation_versions_quotation_id_created_at_idx"
  ON "sales_quotation_versions"("quotation_id", "created_at");
CREATE INDEX "sales_quotation_versions_created_by_idx" ON "sales_quotation_versions"("created_by");

CREATE UNIQUE INDEX "sales_quotation_items_quotation_version_id_line_number_key"
  ON "sales_quotation_items"("quotation_version_id", "line_number");
CREATE INDEX "sales_quotation_items_customer_product_id_idx" ON "sales_quotation_items"("customer_product_id");
CREATE INDEX "sales_quotation_items_product_fingerprint_snapshot_idx"
  ON "sales_quotation_items"("product_fingerprint_snapshot");

ALTER TABLE "customer_products"
  ADD CONSTRAINT "customer_products_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_products"
  ADD CONSTRAINT "customer_products_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_products"
  ADD CONSTRAINT "customer_products_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_quotations"
  ADD CONSTRAINT "sales_quotations_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotations"
  ADD CONSTRAINT "sales_quotations_salesperson_user_id_fkey"
  FOREIGN KEY ("salesperson_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_quotations"
  ADD CONSTRAINT "sales_quotations_voided_by_fkey"
  FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_quotations"
  ADD CONSTRAINT "sales_quotations_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_quotations"
  ADD CONSTRAINT "sales_quotations_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_quotation_versions"
  ADD CONSTRAINT "sales_quotation_versions_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "sales_quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_versions"
  ADD CONSTRAINT "sales_quotation_versions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales_quotation_items"
  ADD CONSTRAINT "sales_quotation_items_quotation_version_id_fkey"
  FOREIGN KEY ("quotation_version_id") REFERENCES "sales_quotation_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_items"
  ADD CONSTRAINT "sales_quotation_items_customer_product_id_fkey"
  FOREIGN KEY ("customer_product_id") REFERENCES "customer_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quote versions and their item snapshots are append-only. Corrections must create
-- the next version instead of rewriting the commercial record that was viewed.
CREATE FUNCTION "reject_sales_quotation_version_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."sealed_at" IS NULL
      AND NEW."sealed_at" IS NOT NULL
      AND (to_jsonb(NEW) - 'sealed_at') = (to_jsonb(OLD) - 'sealed_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'sales quotation snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_quotation_versions_immutable"
  BEFORE UPDATE OR DELETE ON "sales_quotation_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_sales_quotation_version_mutation"();

CREATE FUNCTION "guard_sales_quotation_item_mutation"() RETURNS trigger AS $$
DECLARE
  version_sealed_at TIMESTAMP(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "sealed_at" INTO version_sealed_at
    FROM "sales_quotation_versions"
    WHERE "id" = NEW."quotation_version_id";
    IF version_sealed_at IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'sales quotation item snapshots are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_quotation_items_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "sales_quotation_items"
  FOR EACH ROW EXECUTE FUNCTION "guard_sales_quotation_item_mutation"();

COMMIT;
