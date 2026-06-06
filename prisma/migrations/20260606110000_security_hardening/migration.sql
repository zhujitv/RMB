CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "user_agent" TEXT,
  "ip_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_sessions_token_hash_key" ON "user_sessions"("token_hash");
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx" ON "user_sessions"("user_id");
CREATE INDEX IF NOT EXISTS "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");
CREATE INDEX IF NOT EXISTS "user_sessions_revoked_at_idx" ON "user_sessions"("revoked_at");

ALTER TABLE "user_sessions"
ADD CONSTRAINT "user_sessions_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "login_attempts" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "email" TEXT,
  "ip_address" TEXT,
  "success" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "user_id" TEXT,
  CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "login_attempts_key_created_at_idx" ON "login_attempts"("key", "created_at");
CREATE INDEX IF NOT EXISTS "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at");
CREATE INDEX IF NOT EXISTS "login_attempts_ip_address_created_at_idx" ON "login_attempts"("ip_address", "created_at");

ALTER TABLE "login_attempts"
ADD CONSTRAINT "login_attempts_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "receivable_orders_order_no_active_unique"
ON "receivable_orders" (lower(trim("order_no")))
WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "customers_name_active_unique"
ON "customers" (lower(trim("name")))
WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_name_active_unique"
ON "suppliers" (lower(trim("supplier_name")))
WHERE "deleted_at" IS NULL;
