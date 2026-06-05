CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT '查看者',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "country" TEXT,
  "default_currency" TEXT NOT NULL DEFAULT 'USD',
  "contact_person" TEXT,
  "contact_email" TEXT,
  "contact_phone" TEXT,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customers_name_idx" ON "customers"("name");
CREATE INDEX "customers_deleted_at_idx" ON "customers"("deleted_at");

CREATE TABLE "receivable_orders" (
  "id" TEXT NOT NULL,
  "order_no" TEXT NOT NULL,
  "bl_no" TEXT,
  "customer_id" TEXT NOT NULL,
  "salesperson_id" TEXT,
  "country" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "exchange_rate" DECIMAL(18, 6) NOT NULL,
  "receivable_amount" DECIMAL(18, 2) NOT NULL,
  "receivable_amount_cny" DECIMAL(18, 2) NOT NULL,
  "trade_term" TEXT NOT NULL DEFAULT 'FOB',
  "payment_term" TEXT NOT NULL DEFAULT 'OA账期',
  "expected_payment_date" DATE,
  "credit_days" INTEGER,
  "due_date" DATE,
  "reminder_days" INTEGER NOT NULL DEFAULT 7,
  "status" TEXT NOT NULL DEFAULT '草稿',
  "remark" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "receivable_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receivable_orders_order_no_idx" ON "receivable_orders"("order_no");
CREATE INDEX "receivable_orders_bl_no_idx" ON "receivable_orders"("bl_no");
CREATE INDEX "receivable_orders_customer_id_idx" ON "receivable_orders"("customer_id");
CREATE INDEX "receivable_orders_salesperson_id_idx" ON "receivable_orders"("salesperson_id");
CREATE INDEX "receivable_orders_status_idx" ON "receivable_orders"("status");
CREATE INDEX "receivable_orders_due_date_idx" ON "receivable_orders"("due_date");
CREATE INDEX "receivable_orders_deleted_at_idx" ON "receivable_orders"("deleted_at");

CREATE TABLE "payments" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "payment_date" DATE NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "exchange_rate" DECIMAL(18, 6) NOT NULL,
  "amount" DECIMAL(18, 2) NOT NULL,
  "amount_cny" DECIMAL(18, 2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT '待确认',
  "bank_reference" TEXT,
  "remark" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");
CREATE INDEX "payments_payment_date_idx" ON "payments"("payment_date");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "payments_deleted_at_idx" ON "payments"("deleted_at");

CREATE TABLE "order_costs" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "cost_type" TEXT NOT NULL,
  "vendor_name" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "exchange_rate" DECIMAL(18, 6) NOT NULL,
  "amount" DECIMAL(18, 2) NOT NULL,
  "amount_cny" DECIMAL(18, 2) NOT NULL,
  "payment_status" TEXT NOT NULL DEFAULT '待支付',
  "payment_date" DATE,
  "invoice_status" TEXT NOT NULL DEFAULT '未收到',
  "remark" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "order_costs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_costs_order_id_idx" ON "order_costs"("order_id");
CREATE INDEX "order_costs_cost_type_idx" ON "order_costs"("cost_type");
CREATE INDEX "order_costs_payment_status_idx" ON "order_costs"("payment_status");
CREATE INDEX "order_costs_deleted_at_idx" ON "order_costs"("deleted_at");

CREATE TABLE "attachments" (
  "id" TEXT NOT NULL,
  "related_type" TEXT NOT NULL,
  "related_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_url" TEXT NOT NULL,
  "file_size" INTEGER,
  "mime_type" TEXT,
  "uploaded_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attachments_related_type_related_id_idx" ON "attachments"("related_type", "related_id");
CREATE INDEX "attachments_deleted_at_idx" ON "attachments"("deleted_at");

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "before_data" JSONB,
  "after_data" JSONB,
  "ip_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

ALTER TABLE "receivable_orders" ADD CONSTRAINT "receivable_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receivable_orders" ADD CONSTRAINT "receivable_orders_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "receivable_orders" ADD CONSTRAINT "receivable_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "receivable_orders" ADD CONSTRAINT "receivable_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_costs" ADD CONSTRAINT "order_costs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "users" ("id", "name", "email", "password_hash", "role", "is_active", "created_at", "updated_at")
VALUES ('admin-user', '默认管理员', 'admin@example.com', 'ac0e7d037817094e9e0b4441f9bae3209d67b02fa484917065f71b16109a1a78', '管理员', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("email") DO NOTHING;
