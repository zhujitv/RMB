CREATE TABLE IF NOT EXISTS "export_customs_declaration_items" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "document_id" TEXT,
  "declaration_no" TEXT NOT NULL,
  "declaration_date" DATE,
  "export_date" DATE,
  "hs_code" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "quantity" DECIMAL(18,4),
  "unit" TEXT,
  "trade_term" TEXT,
  "currency" TEXT,
  "fob_amount" DECIMAL(18,2),
  "exchange_rate" DECIMAL(18,6),
  "fob_amount_cny" DECIMAL(18,2),
  "raw_json" JSONB,
  "confirmation_status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "source" TEXT NOT NULL DEFAULT 'OCR_PDF',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "confirmed_by" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "export_customs_declaration_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "export_tax_rebate_rates" (
  "id" TEXT NOT NULL,
  "hs_code" TEXT NOT NULL,
  "product_name" TEXT,
  "rebate_rate" DECIMAL(8,4) NOT NULL,
  "vat_rate" DECIMAL(8,4) NOT NULL,
  "special_flag" TEXT,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "source" TEXT,
  "version" TEXT NOT NULL DEFAULT 'default',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_tax_rebate_rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "export_tax_refund_calculations" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "declaration_item_id" TEXT NOT NULL,
  "rate_id" TEXT,
  "declaration_no" TEXT NOT NULL,
  "hs_code" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "declaration_date" DATE,
  "fob_currency" TEXT,
  "fob_amount" DECIMAL(18,2),
  "exchange_rate" DECIMAL(18,6),
  "declaration_amount_cny" DECIMAL(18,2),
  "rebate_rate" DECIMAL(8,4),
  "vat_rate" DECIMAL(8,4),
  "theoretical_refund_amount" DECIMAL(18,2),
  "supplier_invoice_amount_without_tax" DECIMAL(18,2),
  "available_input_vat_amount" DECIMAL(18,2),
  "estimated_refund_amount" DECIMAL(18,2),
  "invoice_match_status" TEXT NOT NULL DEFAULT '发票缺失',
  "calculation_status" TEXT NOT NULL DEFAULT '资料异常',
  "abnormal_reasons" JSONB,
  "invoice_match_json" JSONB,
  "calculated_at" TIMESTAMP(3),
  "calculated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "export_tax_refund_calculations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "export_tax_rebate_rates_unique_version"
  ON "export_tax_rebate_rates"("hs_code", "effective_from", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "export_tax_refund_calculations_declaration_item_id_key"
  ON "export_tax_refund_calculations"("declaration_item_id");

CREATE INDEX IF NOT EXISTS "export_customs_declaration_items_order_id_idx" ON "export_customs_declaration_items"("order_id");
CREATE INDEX IF NOT EXISTS "export_customs_declaration_items_document_id_idx" ON "export_customs_declaration_items"("document_id");
CREATE INDEX IF NOT EXISTS "export_customs_declaration_items_declaration_no_idx" ON "export_customs_declaration_items"("declaration_no");
CREATE INDEX IF NOT EXISTS "export_customs_declaration_items_hs_code_idx" ON "export_customs_declaration_items"("hs_code");
CREATE INDEX IF NOT EXISTS "export_customs_declaration_items_confirmation_status_idx" ON "export_customs_declaration_items"("confirmation_status");
CREATE INDEX IF NOT EXISTS "export_customs_declaration_items_deleted_at_idx" ON "export_customs_declaration_items"("deleted_at");
CREATE INDEX IF NOT EXISTS "export_customs_items_match_idx"
  ON "export_customs_declaration_items"("order_id", "declaration_no", "hs_code", "product_name", "unit");

CREATE INDEX IF NOT EXISTS "export_tax_rebate_rates_hs_code_idx" ON "export_tax_rebate_rates"("hs_code");
CREATE INDEX IF NOT EXISTS "export_tax_rebate_rates_effective_from_effective_to_idx"
  ON "export_tax_rebate_rates"("effective_from", "effective_to");

CREATE INDEX IF NOT EXISTS "export_tax_refund_calculations_order_id_idx" ON "export_tax_refund_calculations"("order_id");
CREATE INDEX IF NOT EXISTS "export_tax_refund_calculations_rate_id_idx" ON "export_tax_refund_calculations"("rate_id");
CREATE INDEX IF NOT EXISTS "export_tax_refund_calculations_declaration_no_idx" ON "export_tax_refund_calculations"("declaration_no");
CREATE INDEX IF NOT EXISTS "export_tax_refund_calculations_hs_code_idx" ON "export_tax_refund_calculations"("hs_code");
CREATE INDEX IF NOT EXISTS "export_tax_refund_calculations_invoice_match_status_idx" ON "export_tax_refund_calculations"("invoice_match_status");
CREATE INDEX IF NOT EXISTS "export_tax_refund_calculations_calculation_status_idx" ON "export_tax_refund_calculations"("calculation_status");
CREATE INDEX IF NOT EXISTS "export_tax_refund_calculations_deleted_at_idx" ON "export_tax_refund_calculations"("deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'export_customs_declaration_items_order_id_fkey') THEN
    ALTER TABLE "export_customs_declaration_items"
      ADD CONSTRAINT "export_customs_declaration_items_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'export_customs_declaration_items_document_id_fkey') THEN
    ALTER TABLE "export_customs_declaration_items"
      ADD CONSTRAINT "export_customs_declaration_items_document_id_fkey"
      FOREIGN KEY ("document_id") REFERENCES "order_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'export_tax_refund_calculations_order_id_fkey') THEN
    ALTER TABLE "export_tax_refund_calculations"
      ADD CONSTRAINT "export_tax_refund_calculations_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'export_tax_refund_calculations_declaration_item_id_fkey') THEN
    ALTER TABLE "export_tax_refund_calculations"
      ADD CONSTRAINT "export_tax_refund_calculations_declaration_item_id_fkey"
      FOREIGN KEY ("declaration_item_id") REFERENCES "export_customs_declaration_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'export_tax_refund_calculations_rate_id_fkey') THEN
    ALTER TABLE "export_tax_refund_calculations"
      ADD CONSTRAINT "export_tax_refund_calculations_rate_id_fkey"
      FOREIGN KEY ("rate_id") REFERENCES "export_tax_rebate_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
