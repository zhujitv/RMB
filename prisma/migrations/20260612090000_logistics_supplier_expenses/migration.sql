ALTER TABLE "order_costs"
  ADD COLUMN IF NOT EXISTS "logistics_supplier_expense_id" TEXT,
  ADD COLUMN IF NOT EXISTS "custom_cost_name" TEXT;

ALTER TABLE "order_documents"
  ADD COLUMN IF NOT EXISTS "logistics_supplier_expense_id" TEXT,
  ADD COLUMN IF NOT EXISTS "logistics_document_type" TEXT;

CREATE TABLE IF NOT EXISTS "logistics_supplier_expenses" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "order_cost_id" TEXT,
  "expense_type" TEXT NOT NULL,
  "custom_expense_name" TEXT,
  "tax_document_type" TEXT,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "exchange_rate" DECIMAL(18,6) NOT NULL,
  "amount_cny" DECIMAL(18,2) NOT NULL,
  "expense_date" DATE NOT NULL,
  "settlement_month" TEXT NOT NULL,
  "invoice_status" TEXT NOT NULL DEFAULT '未上传',
  "payment_status" TEXT NOT NULL DEFAULT '未付款',
  "review_status" TEXT NOT NULL DEFAULT '草稿',
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "reject_reason" TEXT,
  "remark" TEXT,
  "voided_at" TIMESTAMP(3),
  "void_reason" TEXT,
  "paid_at" TIMESTAMP(3),
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "logistics_supplier_expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_costs_logistics_supplier_expense_id_key"
  ON "order_costs"("logistics_supplier_expense_id");

CREATE INDEX IF NOT EXISTS "order_costs_logistics_supplier_expense_id_idx"
  ON "order_costs"("logistics_supplier_expense_id");

CREATE INDEX IF NOT EXISTS "order_documents_logistics_supplier_expense_id_idx"
  ON "order_documents"("logistics_supplier_expense_id");

CREATE INDEX IF NOT EXISTS "order_documents_logistics_document_type_idx"
  ON "order_documents"("logistics_document_type");

CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_order_id_idx"
  ON "logistics_supplier_expenses"("order_id");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_supplier_id_idx"
  ON "logistics_supplier_expenses"("supplier_id");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_order_cost_id_idx"
  ON "logistics_supplier_expenses"("order_cost_id");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_expense_type_idx"
  ON "logistics_supplier_expenses"("expense_type");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_custom_expense_name_idx"
  ON "logistics_supplier_expenses"("custom_expense_name");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_settlement_month_idx"
  ON "logistics_supplier_expenses"("settlement_month");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_invoice_status_idx"
  ON "logistics_supplier_expenses"("invoice_status");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_payment_status_idx"
  ON "logistics_supplier_expenses"("payment_status");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_review_status_idx"
  ON "logistics_supplier_expenses"("review_status");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_reviewed_by_idx"
  ON "logistics_supplier_expenses"("reviewed_by");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_created_by_idx"
  ON "logistics_supplier_expenses"("created_by");
CREATE INDEX IF NOT EXISTS "logistics_supplier_expenses_deleted_at_idx"
  ON "logistics_supplier_expenses"("deleted_at");

ALTER TABLE "logistics_supplier_expenses"
  ADD CONSTRAINT "logistics_supplier_expenses_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_supplier_expenses"
  ADD CONSTRAINT "logistics_supplier_expenses_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "logistics_supplier_expenses"
  ADD CONSTRAINT "logistics_supplier_expenses_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "logistics_supplier_expenses"
  ADD CONSTRAINT "logistics_supplier_expenses_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "logistics_supplier_expenses"
  ADD CONSTRAINT "logistics_supplier_expenses_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_costs"
  ADD CONSTRAINT "order_costs_logistics_supplier_expense_id_fkey"
  FOREIGN KEY ("logistics_supplier_expense_id") REFERENCES "logistics_supplier_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_documents"
  ADD CONSTRAINT "order_documents_logistics_supplier_expense_id_fkey"
  FOREIGN KEY ("logistics_supplier_expense_id") REFERENCES "logistics_supplier_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
