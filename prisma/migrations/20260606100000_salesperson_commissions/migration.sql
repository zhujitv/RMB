ALTER TABLE "customers"
  ADD COLUMN "commission_rate" DECIMAL(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "commission_status" TEXT NOT NULL DEFAULT '启用';

ALTER TABLE "receivable_orders"
  ADD COLUMN "salesperson_commission_rate" DECIMAL(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "commission_status" TEXT NOT NULL DEFAULT '未结算',
  ADD COLUMN "commission_settled_by" TEXT,
  ADD COLUMN "commission_settled_at" TIMESTAMP(3),
  ADD COLUMN "commission_settlement_remark" TEXT;

ALTER TABLE "order_costs"
  ADD COLUMN "cost_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cost_confirmed_at" TIMESTAMP(3);

CREATE INDEX "customers_commission_status_idx" ON "customers"("commission_status");
CREATE INDEX "receivable_orders_commission_status_idx" ON "receivable_orders"("commission_status");
CREATE INDEX "receivable_orders_commission_settled_by_idx" ON "receivable_orders"("commission_settled_by");
CREATE INDEX "order_costs_cost_confirmed_idx" ON "order_costs"("cost_confirmed");

ALTER TABLE "receivable_orders"
  ADD CONSTRAINT "receivable_orders_commission_settled_by_fkey"
  FOREIGN KEY ("commission_settled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
