CREATE TABLE "customer_follow_ups" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "method" TEXT,
  "note" TEXT NOT NULL,
  "next_follow_up_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_follow_ups_customer_id_next_follow_up_at_idx" ON "customer_follow_ups"("customer_id", "next_follow_up_at");
CREATE INDEX "customer_follow_ups_customer_id_completed_at_idx" ON "customer_follow_ups"("customer_id", "completed_at");
CREATE INDEX "customer_follow_ups_created_by_idx" ON "customer_follow_ups"("created_by");
CREATE INDEX "customer_follow_ups_updated_by_idx" ON "customer_follow_ups"("updated_by");

ALTER TABLE "customer_follow_ups"
  ADD CONSTRAINT "customer_follow_ups_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_follow_ups"
  ADD CONSTRAINT "customer_follow_ups_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_follow_ups"
  ADD CONSTRAINT "customer_follow_ups_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
