ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "enable_auto_shipping_docs_notification" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shipping_docs_emails" JSONB,
  ADD COLUMN IF NOT EXISTS "shipping_docs_cc_emails" JSONB,
  ADD COLUMN IF NOT EXISTS "auto_send_document_types" JSONB;

CREATE TABLE IF NOT EXISTS "shipping_document_notifications" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "invoice_id" TEXT,
  "recipient_emails" JSONB NOT NULL,
  "cc_emails" JSONB,
  "document_types" JSONB NOT NULL,
  "attachment_file_ids" JSONB NOT NULL,
  "send_status" TEXT NOT NULL DEFAULT 'pending',
  "send_mode" TEXT NOT NULL DEFAULT 'auto',
  "error_message" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "shipping_document_notifications_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipping_document_notifications_order_id_fkey'
  ) THEN
    ALTER TABLE "shipping_document_notifications"
      ADD CONSTRAINT "shipping_document_notifications_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "receivable_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipping_document_notifications_customer_id_fkey'
  ) THEN
    ALTER TABLE "shipping_document_notifications"
      ADD CONSTRAINT "shipping_document_notifications_customer_id_fkey"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "shipping_document_notifications_order_id_idx" ON "shipping_document_notifications"("order_id");
CREATE INDEX IF NOT EXISTS "shipping_document_notifications_customer_id_idx" ON "shipping_document_notifications"("customer_id");
CREATE INDEX IF NOT EXISTS "shipping_document_notifications_invoice_id_idx" ON "shipping_document_notifications"("invoice_id");
CREATE INDEX IF NOT EXISTS "shipping_document_notifications_send_status_idx" ON "shipping_document_notifications"("send_status");
CREATE INDEX IF NOT EXISTS "shipping_document_notifications_send_mode_idx" ON "shipping_document_notifications"("send_mode");
CREATE INDEX IF NOT EXISTS "shipping_document_notifications_sent_at_idx" ON "shipping_document_notifications"("sent_at");
