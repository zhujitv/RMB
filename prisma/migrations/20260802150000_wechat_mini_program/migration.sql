CREATE TABLE "wechat_mini_bindings" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "open_id" TEXT NOT NULL,
  "union_id" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wechat_mini_bindings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wechat_mini_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "binding_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wechat_mini_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wechat_mini_subscription_grants" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "binding_id" TEXT NOT NULL,
  "open_id" TEXT NOT NULL,
  "template_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reserved_at" TIMESTAMP(3),
  "consumed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wechat_mini_subscription_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wechat_mini_deliveries" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "grant_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "page" TEXT,
  "order_no" TEXT NOT NULL,
  "status_text" TEXT NOT NULL,
  "event_time_text" TEXT NOT NULL,
  "event_text" TEXT NOT NULL,
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
  CONSTRAINT "wechat_mini_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wechat_mini_bindings_user_id_key" ON "wechat_mini_bindings"("user_id");
CREATE UNIQUE INDEX "wechat_mini_bindings_open_id_key" ON "wechat_mini_bindings"("open_id");
CREATE INDEX "wechat_mini_bindings_enabled_idx" ON "wechat_mini_bindings"("enabled");
CREATE INDEX "wechat_mini_bindings_union_id_idx" ON "wechat_mini_bindings"("union_id");
CREATE UNIQUE INDEX "wechat_mini_sessions_token_hash_key" ON "wechat_mini_sessions"("token_hash");
CREATE INDEX "wechat_mini_sessions_user_id_expires_at_idx" ON "wechat_mini_sessions"("user_id", "expires_at");
CREATE INDEX "wechat_mini_sessions_binding_id_idx" ON "wechat_mini_sessions"("binding_id");
CREATE INDEX "wechat_mini_sessions_revoked_at_idx" ON "wechat_mini_sessions"("revoked_at");
CREATE INDEX "wechat_mini_subscription_grants_user_id_template_id_status_granted_at_idx" ON "wechat_mini_subscription_grants"("user_id", "template_id", "status", "granted_at");
CREATE INDEX "wechat_mini_subscription_grants_binding_id_idx" ON "wechat_mini_subscription_grants"("binding_id");
CREATE INDEX "wechat_mini_subscription_grants_status_expires_at_idx" ON "wechat_mini_subscription_grants"("status", "expires_at");
CREATE UNIQUE INDEX "wechat_mini_deliveries_grant_id_key" ON "wechat_mini_deliveries"("grant_id");
CREATE UNIQUE INDEX "wechat_mini_deliveries_idempotency_key_key" ON "wechat_mini_deliveries"("idempotency_key");
CREATE INDEX "wechat_mini_deliveries_status_scheduled_at_idx" ON "wechat_mini_deliveries"("status", "scheduled_at");
CREATE INDEX "wechat_mini_deliveries_user_id_created_at_idx" ON "wechat_mini_deliveries"("user_id", "created_at");
CREATE INDEX "wechat_mini_deliveries_related_order_id_idx" ON "wechat_mini_deliveries"("related_order_id");
CREATE INDEX "wechat_mini_deliveries_related_entity_type_related_entity_id_idx" ON "wechat_mini_deliveries"("related_entity_type", "related_entity_id");

ALTER TABLE "wechat_mini_bindings" ADD CONSTRAINT "wechat_mini_bindings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wechat_mini_sessions" ADD CONSTRAINT "wechat_mini_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wechat_mini_sessions" ADD CONSTRAINT "wechat_mini_sessions_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "wechat_mini_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wechat_mini_subscription_grants" ADD CONSTRAINT "wechat_mini_subscription_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wechat_mini_subscription_grants" ADD CONSTRAINT "wechat_mini_subscription_grants_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "wechat_mini_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wechat_mini_deliveries" ADD CONSTRAINT "wechat_mini_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wechat_mini_deliveries" ADD CONSTRAINT "wechat_mini_deliveries_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "wechat_mini_subscription_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
