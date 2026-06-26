ALTER TABLE "receivable_orders"
  ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "receivable_orders_is_archived_idx"
  ON "receivable_orders" ("is_archived");
