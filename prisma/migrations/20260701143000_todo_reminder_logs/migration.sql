CREATE TABLE IF NOT EXISTS "todo_reminder_logs" (
  "id" TEXT NOT NULL,
  "todo_id" TEXT NOT NULL,
  "todo_type" TEXT NOT NULL,
  "related_order_id" TEXT,
  "owner_user_id" TEXT NOT NULL,
  "owner_email" TEXT NOT NULL,
  "reminded_at" TIMESTAMP(3) NOT NULL,
  "reminder_date" DATE NOT NULL,
  "overdue_days" INTEGER NOT NULL,
  "email_status" TEXT NOT NULL,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "todo_reminder_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "todo_reminder_logs_daily_unique"
ON "todo_reminder_logs"("todo_id", "owner_user_id", "reminder_date");

CREATE INDEX IF NOT EXISTS "todo_reminder_logs_todo_type_idx"
ON "todo_reminder_logs"("todo_type");

CREATE INDEX IF NOT EXISTS "todo_reminder_logs_related_order_id_idx"
ON "todo_reminder_logs"("related_order_id");

CREATE INDEX IF NOT EXISTS "todo_reminder_logs_owner_user_id_idx"
ON "todo_reminder_logs"("owner_user_id");

CREATE INDEX IF NOT EXISTS "todo_reminder_logs_reminder_date_idx"
ON "todo_reminder_logs"("reminder_date");

CREATE INDEX IF NOT EXISTS "todo_reminder_logs_email_status_idx"
ON "todo_reminder_logs"("email_status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'todo_reminder_logs_owner_user_id_fkey'
  ) THEN
    ALTER TABLE "todo_reminder_logs"
      ADD CONSTRAINT "todo_reminder_logs_owner_user_id_fkey"
      FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
