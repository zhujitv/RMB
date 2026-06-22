ALTER TABLE "logistics_transport_items"
  ADD COLUMN IF NOT EXISTS "container_type" TEXT,
  ADD COLUMN IF NOT EXISTS "seal_no" TEXT;
