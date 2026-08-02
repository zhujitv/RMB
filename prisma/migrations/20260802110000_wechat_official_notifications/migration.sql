BEGIN;

CREATE TABLE "wechat_official_bindings" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "open_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wechat_official_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wechat_official_subscriptions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "open_id" TEXT,
  "template_id" TEXT NOT NULL,
  "scene" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wechat_official_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wechat_official_deliveries" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "url" TEXT,
  "related_entity_type" TEXT,
  "related_entity_id" TEXT,
  "related_order_id" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "scheduled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider_accepted_at" TIMESTAMP(3),
  "outcome_unknown_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wechat_official_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wechat_official_bindings_user_id_key" ON "wechat_official_bindings"("user_id");
CREATE UNIQUE INDEX "wechat_official_bindings_open_id_key" ON "wechat_official_bindings"("open_id");
CREATE INDEX "wechat_official_bindings_enabled_idx" ON "wechat_official_bindings"("enabled");
CREATE UNIQUE INDEX "wechat_official_subscriptions_token_hash_key" ON "wechat_official_subscriptions"("token_hash");
CREATE INDEX "wechat_official_subscriptions_user_id_status_created_at_idx" ON "wechat_official_subscriptions"("user_id", "status", "created_at");
CREATE INDEX "wechat_official_subscriptions_status_expires_at_idx" ON "wechat_official_subscriptions"("status", "expires_at");
CREATE INDEX "wechat_official_subscriptions_open_id_idx" ON "wechat_official_subscriptions"("open_id");
CREATE UNIQUE INDEX "wechat_official_deliveries_subscription_id_key" ON "wechat_official_deliveries"("subscription_id");
CREATE UNIQUE INDEX "wechat_official_deliveries_idempotency_key_key" ON "wechat_official_deliveries"("idempotency_key");
CREATE INDEX "wechat_official_deliveries_status_scheduled_at_idx" ON "wechat_official_deliveries"("status", "scheduled_at");
CREATE INDEX "wechat_official_deliveries_user_id_created_at_idx" ON "wechat_official_deliveries"("user_id", "created_at");
CREATE INDEX "wechat_official_deliveries_related_order_id_idx" ON "wechat_official_deliveries"("related_order_id");
CREATE INDEX "wechat_official_deliveries_related_entity_type_related_entity_id_idx" ON "wechat_official_deliveries"("related_entity_type", "related_entity_id");

ALTER TABLE "wechat_official_bindings"
  ADD CONSTRAINT "wechat_official_bindings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wechat_official_subscriptions"
  ADD CONSTRAINT "wechat_official_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wechat_official_deliveries"
  ADD CONSTRAINT "wechat_official_deliveries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wechat_official_deliveries"
  ADD CONSTRAINT "wechat_official_deliveries_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "wechat_official_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
