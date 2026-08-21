CREATE TABLE IF NOT EXISTS "crm_email_accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "english_name" TEXT NOT NULL,
  "local_part" TEXT NOT NULL,
  "email_address" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "crm_email_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "crm_email_messages" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "account_id" TEXT,
  "direction" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "from_name" TEXT,
  "from_email" TEXT NOT NULL,
  "to_emails" JSONB NOT NULL,
  "cc_emails" JSONB,
  "subject" TEXT NOT NULL,
  "body_text" TEXT NOT NULL,
  "message_id" TEXT,
  "thread_key" TEXT,
  "related_quotation_id" TEXT,
  "related_order_id" TEXT,
  "last_error" TEXT,
  "sent_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3),
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "crm_email_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_accounts_user_id_key" ON "crm_email_accounts"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_accounts_local_part_key" ON "crm_email_accounts"("local_part");
CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_accounts_email_address_key" ON "crm_email_accounts"("email_address");
CREATE INDEX IF NOT EXISTS "crm_email_accounts_status_idx" ON "crm_email_accounts"("status");
CREATE INDEX IF NOT EXISTS "crm_email_accounts_deleted_at_idx" ON "crm_email_accounts"("deleted_at");

CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_messages_message_id_key" ON "crm_email_messages"("message_id");
CREATE INDEX IF NOT EXISTS "crm_email_messages_customer_id_created_at_idx" ON "crm_email_messages"("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_email_messages_account_id_created_at_idx" ON "crm_email_messages"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "crm_email_messages_direction_status_idx" ON "crm_email_messages"("direction", "status");
CREATE INDEX IF NOT EXISTS "crm_email_messages_thread_key_idx" ON "crm_email_messages"("thread_key");
CREATE INDEX IF NOT EXISTS "crm_email_messages_related_quotation_id_idx" ON "crm_email_messages"("related_quotation_id");
CREATE INDEX IF NOT EXISTS "crm_email_messages_related_order_id_idx" ON "crm_email_messages"("related_order_id");
CREATE INDEX IF NOT EXISTS "crm_email_messages_created_by_idx" ON "crm_email_messages"("created_by");
CREATE INDEX IF NOT EXISTS "crm_email_messages_updated_by_idx" ON "crm_email_messages"("updated_by");
CREATE INDEX IF NOT EXISTS "crm_email_messages_deleted_at_idx" ON "crm_email_messages"("deleted_at");

ALTER TABLE "crm_email_accounts"
  ADD CONSTRAINT "crm_email_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_email_messages"
  ADD CONSTRAINT "crm_email_messages_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "crm_email_messages"
  ADD CONSTRAINT "crm_email_messages_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "crm_email_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_email_messages"
  ADD CONSTRAINT "crm_email_messages_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_email_messages"
  ADD CONSTRAINT "crm_email_messages_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
