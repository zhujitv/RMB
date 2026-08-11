-- Standard Official Account template messages are reusable. Deliveries now
-- reference the durable user/OpenID binding instead of consuming a one-time
-- subscription grant. Existing one-time delivery records remain readable.
ALTER TABLE "wechat_official_deliveries"
  ALTER COLUMN "subscription_id" DROP NOT NULL,
  ADD COLUMN "binding_id" TEXT,
  ADD COLUMN "order_no" TEXT,
  ADD COLUMN "status_text" TEXT,
  ADD COLUMN "event_time_text" TEXT,
  ADD COLUMN "event_text" TEXT;

CREATE INDEX "wechat_official_deliveries_binding_id_idx"
  ON "wechat_official_deliveries"("binding_id");

ALTER TABLE "wechat_official_deliveries"
  ADD CONSTRAINT "wechat_official_deliveries_binding_id_fkey"
  FOREIGN KEY ("binding_id") REFERENCES "wechat_official_bindings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
