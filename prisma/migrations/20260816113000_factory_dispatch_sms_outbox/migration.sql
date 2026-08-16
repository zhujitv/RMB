BEGIN;

ALTER TABLE "notification_outbox"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "recipient_phones" JSONB;

ALTER TABLE "notification_delivery_logs"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN "recipient_phones" JSONB;

ALTER TABLE "factory_purchase_orders"
  ADD COLUMN "dispatch_sms_status" TEXT,
  ADD COLUMN "dispatch_sms_sent_at" TIMESTAMP(3),
  ADD COLUMN "dispatch_sms_error" TEXT,
  ADD COLUMN "dispatch_recipient_phones" JSONB;

ALTER TABLE "suppliers"
  ADD COLUMN "dispatch_sms_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dispatch_sms_phone" TEXT;

CREATE INDEX "notification_outbox_channel_status_scheduled_at_idx"
  ON "notification_outbox"("channel", "status", "scheduled_at");

ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_channel_check"
  CHECK ("channel" IN ('EMAIL', 'SMS'));

ALTER TABLE "notification_delivery_logs"
  ADD CONSTRAINT "notification_delivery_logs_channel_check"
  CHECK ("channel" IN ('EMAIL', 'SMS'));

ALTER TABLE "factory_purchase_orders"
  ADD CONSTRAINT "factory_purchase_orders_dispatch_sms_status_check"
  CHECK (
    "dispatch_sms_status" IS NULL
    OR "dispatch_sms_status" IN (
      'NOT_SENT', 'SENDING', 'SUBMITTED', 'RETRYING', 'FAILED', 'UNKNOWN',
      'NO_RECIPIENT', 'DISABLED', 'CONFIG_ERROR', 'CANCELLED'
    )
  );

COMMIT;
