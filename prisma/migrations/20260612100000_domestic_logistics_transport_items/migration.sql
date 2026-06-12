CREATE TABLE IF NOT EXISTS "logistics_transport_items" (
  "id" TEXT NOT NULL,
  "logistics_info_id" TEXT NOT NULL,
  "container_no" TEXT,
  "truck_plate_no" TEXT,
  "trailer_plate_no" TEXT,
  "departure_date" DATE,
  "departure_place" TEXT,
  "arrival_place" TEXT,
  "cargo_name" TEXT,
  "remark" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "logistics_transport_items_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'logistics_transport_items_logistics_info_id_fkey'
  ) THEN
    ALTER TABLE "logistics_transport_items"
    ADD CONSTRAINT "logistics_transport_items_logistics_info_id_fkey"
    FOREIGN KEY ("logistics_info_id")
    REFERENCES "domestic_logistics_infos"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "logistics_transport_items_logistics_info_id_idx" ON "logistics_transport_items"("logistics_info_id");
CREATE INDEX IF NOT EXISTS "logistics_transport_items_sort_order_idx" ON "logistics_transport_items"("sort_order");
