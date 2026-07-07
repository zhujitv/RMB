ALTER TABLE "shipping_document_notifications"
  ADD COLUMN IF NOT EXISTS "delivery_method" TEXT,
  ADD COLUMN IF NOT EXISTS "manual_remark" TEXT,
  ADD COLUMN IF NOT EXISTS "is_system_sent" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "shipping_document_notifications_is_system_sent_idx"
  ON "shipping_document_notifications"("is_system_sent");
