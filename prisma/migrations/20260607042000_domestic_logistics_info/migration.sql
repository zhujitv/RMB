ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "supplier_id" TEXT;

ALTER TABLE "suppliers"
ADD COLUMN IF NOT EXISTS "allow_domestic_logistics_entry" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "domestic_logistics_infos" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "transport_type" TEXT NOT NULL,
  "truck_plate_no" TEXT,
  "trailer_plate_no" TEXT,
  "departure_place" TEXT,
  "departure_date" DATE,
  "express_tracking_no" TEXT,
  "remark_text" TEXT,
  "responsible_supplier_id" TEXT,
  "submitted_by_user_id" TEXT,
  "submitted_at" TIMESTAMP(3),
  "finance_status" TEXT NOT NULL DEFAULT 'PENDING',
  "finance_confirmed_by" TEXT,
  "finance_confirmed_at" TIMESTAMP(3),
  "reject_reason" TEXT,
  "correction_requested" BOOLEAN NOT NULL DEFAULT false,
  "correction_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domestic_logistics_infos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "users_supplier_id_idx" ON "users"("supplier_id");
CREATE INDEX IF NOT EXISTS "suppliers_allow_domestic_logistics_entry_idx" ON "suppliers"("allow_domestic_logistics_entry");
CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_order_id_idx" ON "domestic_logistics_infos"("order_id");
CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_responsible_supplier_id_idx" ON "domestic_logistics_infos"("responsible_supplier_id");
CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_submitted_by_user_id_idx" ON "domestic_logistics_infos"("submitted_by_user_id");
CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_finance_status_idx" ON "domestic_logistics_infos"("finance_status");
CREATE INDEX IF NOT EXISTS "domestic_logistics_infos_submitted_at_idx" ON "domestic_logistics_infos"("submitted_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_supplier_id_fkey'
  ) THEN
    ALTER TABLE "users"
    ADD CONSTRAINT "users_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'domestic_logistics_infos_order_id_fkey'
  ) THEN
    ALTER TABLE "domestic_logistics_infos"
    ADD CONSTRAINT "domestic_logistics_infos_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'domestic_logistics_infos_responsible_supplier_id_fkey'
  ) THEN
    ALTER TABLE "domestic_logistics_infos"
    ADD CONSTRAINT "domestic_logistics_infos_responsible_supplier_id_fkey"
    FOREIGN KEY ("responsible_supplier_id") REFERENCES "suppliers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'domestic_logistics_infos_submitted_by_user_id_fkey'
  ) THEN
    ALTER TABLE "domestic_logistics_infos"
    ADD CONSTRAINT "domestic_logistics_infos_submitted_by_user_id_fkey"
    FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'domestic_logistics_infos_finance_confirmed_by_fkey'
  ) THEN
    ALTER TABLE "domestic_logistics_infos"
    ADD CONSTRAINT "domestic_logistics_infos_finance_confirmed_by_fkey"
    FOREIGN KEY ("finance_confirmed_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
