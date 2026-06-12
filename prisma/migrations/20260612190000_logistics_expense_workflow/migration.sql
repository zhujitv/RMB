UPDATE "users"
SET "role" = '物流供应商'
WHERE "role" = '物流资料录入员';

ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "allow_logistics_expense_entry" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allow_logistics_invoice_upload" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allowed_logistics_cost_types" JSONB;

ALTER TABLE "order_costs"
  ADD COLUMN IF NOT EXISTS "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "source_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "order_costs_source_unique"
ON "order_costs"("source_type", "source_id");

CREATE INDEX IF NOT EXISTS "order_costs_source_type_idx" ON "order_costs"("source_type");
CREATE INDEX IF NOT EXISTS "order_costs_source_id_idx" ON "order_costs"("source_id");

CREATE TABLE IF NOT EXISTS "order_logistics_suppliers" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "assigned_by" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_logistics_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_logistics_suppliers_order_id_supplier_id_key"
ON "order_logistics_suppliers"("order_id", "supplier_id");
CREATE INDEX IF NOT EXISTS "order_logistics_suppliers_order_id_idx" ON "order_logistics_suppliers"("order_id");
CREATE INDEX IF NOT EXISTS "order_logistics_suppliers_supplier_id_idx" ON "order_logistics_suppliers"("supplier_id");
CREATE INDEX IF NOT EXISTS "order_logistics_suppliers_assigned_by_idx" ON "order_logistics_suppliers"("assigned_by");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_logistics_suppliers_order_id_fkey'
  ) THEN
    ALTER TABLE "order_logistics_suppliers"
      ADD CONSTRAINT "order_logistics_suppliers_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_logistics_suppliers_supplier_id_fkey'
  ) THEN
    ALTER TABLE "order_logistics_suppliers"
      ADD CONSTRAINT "order_logistics_suppliers_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_logistics_suppliers_assigned_by_fkey'
  ) THEN
    ALTER TABLE "order_logistics_suppliers"
      ADD CONSTRAINT "order_logistics_suppliers_assigned_by_fkey"
      FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "logistics_expenses" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "cost_id" TEXT,
  "supplier_name_snapshot" TEXT NOT NULL DEFAULT '',
  "cost_type" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "exchange_rate" DECIMAL(18,6) NOT NULL,
  "exchange_rate_date" DATE,
  "exchange_rate_source" TEXT,
  "exchange_rate_type" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "amount_cny" DECIMAL(18,2) NOT NULL,
  "remark" TEXT,
  "audit_status" TEXT NOT NULL DEFAULT '草稿',
  "invoice_status" TEXT NOT NULL DEFAULT '未通知',
  "payment_status" TEXT NOT NULL DEFAULT '待开票',
  "submitted_at" TIMESTAMP(3),
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_remark" TEXT,
  "reject_reason" TEXT,
  "invoice_no" TEXT,
  "invoice_date" DATE,
  "invoice_amount" DECIMAL(18,2),
  "invoice_remark" TEXT,
  "invoice_document_id" TEXT,
  "invoice_uploaded_by" TEXT,
  "invoice_uploaded_at" TIMESTAMP(3),
  "invoice_confirmed_by" TEXT,
  "invoice_confirmed_at" TIMESTAMP(3),
  "force_confirm_reason" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "logistics_expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "logistics_expenses_invoice_document_id_key" ON "logistics_expenses"("invoice_document_id");
CREATE UNIQUE INDEX IF NOT EXISTS "logistics_expenses_cost_id_key" ON "logistics_expenses"("cost_id");
CREATE INDEX IF NOT EXISTS "logistics_expenses_order_id_idx" ON "logistics_expenses"("order_id");
CREATE INDEX IF NOT EXISTS "logistics_expenses_supplier_id_idx" ON "logistics_expenses"("supplier_id");
CREATE INDEX IF NOT EXISTS "logistics_expenses_cost_id_idx" ON "logistics_expenses"("cost_id");
CREATE INDEX IF NOT EXISTS "logistics_expenses_cost_type_idx" ON "logistics_expenses"("cost_type");
CREATE INDEX IF NOT EXISTS "logistics_expenses_audit_status_idx" ON "logistics_expenses"("audit_status");
CREATE INDEX IF NOT EXISTS "logistics_expenses_invoice_status_idx" ON "logistics_expenses"("invoice_status");
CREATE INDEX IF NOT EXISTS "logistics_expenses_payment_status_idx" ON "logistics_expenses"("payment_status");
CREATE INDEX IF NOT EXISTS "logistics_expenses_created_by_idx" ON "logistics_expenses"("created_by");
CREATE INDEX IF NOT EXISTS "logistics_expenses_reviewed_by_idx" ON "logistics_expenses"("reviewed_by");
CREATE INDEX IF NOT EXISTS "logistics_expenses_deleted_at_idx" ON "logistics_expenses"("deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_order_id_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_supplier_id_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_supplier_id_fkey"
      FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_cost_id_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_cost_id_fkey"
      FOREIGN KEY ("cost_id") REFERENCES "order_costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_created_by_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_updated_by_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_updated_by_fkey"
      FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_reviewed_by_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_reviewed_by_fkey"
      FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_invoice_document_id_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_invoice_document_id_fkey"
      FOREIGN KEY ("invoice_document_id") REFERENCES "order_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_invoice_uploaded_by_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_invoice_uploaded_by_fkey"
      FOREIGN KEY ("invoice_uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_expenses_invoice_confirmed_by_fkey') THEN
    ALTER TABLE "logistics_expenses"
      ADD CONSTRAINT "logistics_expenses_invoice_confirmed_by_fkey"
      FOREIGN KEY ("invoice_confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
