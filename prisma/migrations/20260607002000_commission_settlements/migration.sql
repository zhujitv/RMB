CREATE TABLE IF NOT EXISTS "commission_settlements" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "salesperson_user_id" TEXT,
  "commission_rate" DECIMAL(8,2) NOT NULL,
  "paid_amount_cny" DECIMAL(18,2) NOT NULL,
  "logistics_cost_cny" DECIMAL(18,2) NOT NULL,
  "commission_base_cny" DECIMAL(18,2) NOT NULL,
  "commission_amount_cny" DECIMAL(18,2) NOT NULL,
  "settled_by" TEXT NOT NULL,
  "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_settlements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "commission_settlements_order_id_idx" ON "commission_settlements"("order_id");
CREATE INDEX IF NOT EXISTS "commission_settlements_salesperson_user_id_idx" ON "commission_settlements"("salesperson_user_id");
CREATE INDEX IF NOT EXISTS "commission_settlements_settled_by_idx" ON "commission_settlements"("settled_by");
CREATE INDEX IF NOT EXISTS "commission_settlements_settled_at_idx" ON "commission_settlements"("settled_at");

DO $$ BEGIN
  ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_salesperson_user_id_fkey" FOREIGN KEY ("salesperson_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_settled_by_fkey" FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
