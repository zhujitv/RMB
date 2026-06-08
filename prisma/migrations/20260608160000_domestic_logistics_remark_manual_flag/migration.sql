ALTER TABLE "domestic_logistics_infos"
  ADD COLUMN IF NOT EXISTS "remark_text_manual_edited" BOOLEAN NOT NULL DEFAULT false;
