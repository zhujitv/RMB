-- Add destination and cargo description to domestic logistics information.
ALTER TABLE "domestic_logistics_infos"
  ADD COLUMN IF NOT EXISTS "destination_place" TEXT,
  ADD COLUMN IF NOT EXISTS "cargo_description" TEXT;
