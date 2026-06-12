ALTER TABLE "shipping_document_notifications"
  ADD COLUMN IF NOT EXISTS "sent_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "email_language" TEXT,
  ADD COLUMN IF NOT EXISTS "email_subject" TEXT,
  ADD COLUMN IF NOT EXISTS "email_body" TEXT;

CREATE INDEX IF NOT EXISTS "shipping_document_notifications_sent_by_id_idx" ON "shipping_document_notifications"("sent_by_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shipping_document_notifications_sent_by_id_fkey'
  ) THEN
    ALTER TABLE "shipping_document_notifications"
      ADD CONSTRAINT "shipping_document_notifications_sent_by_id_fkey"
      FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
