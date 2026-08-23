BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

CREATE TYPE "CustomerOpportunityStage" AS ENUM ('LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

CREATE TABLE "customer_contacts" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "title" TEXT,
  "department" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "wechat" TEXT,
  "preferred_method" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "remark" TEXT,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_opportunities" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "stage" "CustomerOpportunityStage" NOT NULL DEFAULT 'LEAD',
  "amount" DECIMAL(18,2),
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "probability" INTEGER NOT NULL DEFAULT 10,
  "expected_close_date" DATE,
  "next_action" TEXT,
  "owner_user_id" TEXT,
  "lost_reason" TEXT,
  "remark" TEXT,
  "closed_at" TIMESTAMP(3),
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_opportunities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_contacts_customer_id_is_primary_deleted_at_idx" ON "customer_contacts"("customer_id", "is_primary", "deleted_at");
CREATE UNIQUE INDEX "customer_contacts_one_active_primary" ON "customer_contacts"("customer_id") WHERE "is_primary" = true AND "deleted_at" IS NULL;
CREATE INDEX "customer_contacts_created_by_idx" ON "customer_contacts"("created_by");
CREATE INDEX "customer_contacts_updated_by_idx" ON "customer_contacts"("updated_by");
CREATE INDEX "customer_opportunities_customer_id_stage_deleted_at_idx" ON "customer_opportunities"("customer_id", "stage", "deleted_at");
CREATE INDEX "customer_opportunities_owner_user_id_stage_idx" ON "customer_opportunities"("owner_user_id", "stage");
CREATE INDEX "customer_opportunities_expected_close_date_idx" ON "customer_opportunities"("expected_close_date");

ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_opportunities" ADD CONSTRAINT "customer_opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_opportunities" ADD CONSTRAINT "customer_opportunities_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_opportunities" ADD CONSTRAINT "customer_opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_opportunities" ADD CONSTRAINT "customer_opportunities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "customer_contacts" ("id", "customer_id", "name", "phone", "email", "is_primary", "created_at", "updated_at")
SELECT 'legacy_' || "id", "id", COALESCE(NULLIF("contact_person", ''), '主要联系人'), "contact_phone", "contact_email", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "customers"
WHERE "deleted_at" IS NULL AND (NULLIF("contact_person", '') IS NOT NULL OR NULLIF("contact_phone", '') IS NOT NULL OR NULLIF("contact_email", '') IS NOT NULL);

COMMIT;
