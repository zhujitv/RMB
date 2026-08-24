BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

CREATE TYPE "CustomerOpportunityActivityType" AS ENUM (
  'WECHAT', 'PHONE', 'EMAIL', 'WHATSAPP', 'MEETING', 'SAMPLE', 'QUOTATION', 'FOLLOW_UP', 'OTHER'
);

ALTER TABLE "customer_opportunities"
  ADD COLUMN "next_action_due_at" DATE,
  ADD COLUMN "lost_reason_code" TEXT;

ALTER TABLE "sales_quotations"
  ADD COLUMN "opportunity_id" TEXT;

CREATE TABLE "customer_opportunity_contacts" (
  "id" TEXT NOT NULL,
  "opportunity_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "role" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_opportunity_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_opportunity_activities" (
  "id" TEXT NOT NULL,
  "opportunity_id" TEXT NOT NULL,
  "contact_id" TEXT,
  "type" "CustomerOpportunityActivityType" NOT NULL,
  "subject" TEXT NOT NULL,
  "note" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outcome" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "customer_opportunity_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_opportunity_stage_history" (
  "id" TEXT NOT NULL,
  "opportunity_id" TEXT NOT NULL,
  "from_stage" "CustomerOpportunityStage",
  "to_stage" "CustomerOpportunityStage" NOT NULL,
  "note" TEXT,
  "changed_by" TEXT,
  "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_opportunity_stage_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_opportunity_contacts_opportunity_id_contact_id_key" ON "customer_opportunity_contacts"("opportunity_id", "contact_id");
CREATE INDEX "customer_opportunity_contacts_contact_id_deleted_at_idx" ON "customer_opportunity_contacts"("contact_id", "deleted_at");
CREATE UNIQUE INDEX "customer_opportunity_one_active_primary_contact" ON "customer_opportunity_contacts"("opportunity_id") WHERE "is_primary" = true AND "deleted_at" IS NULL;
CREATE INDEX "customer_opportunity_activities_opportunity_id_occurred_at_idx" ON "customer_opportunity_activities"("opportunity_id", "occurred_at");
CREATE INDEX "customer_opportunity_activities_contact_id_idx" ON "customer_opportunity_activities"("contact_id");
CREATE INDEX "customer_opportunity_stage_history_opportunity_id_changed_at_idx" ON "customer_opportunity_stage_history"("opportunity_id", "changed_at");
CREATE INDEX "customer_opportunities_owner_user_id_next_action_due_at_stage_idx" ON "customer_opportunities"("owner_user_id", "next_action_due_at", "stage");
CREATE INDEX "sales_quotations_opportunity_id_status_idx" ON "sales_quotations"("opportunity_id", "status");

ALTER TABLE "customer_opportunity_contacts" ADD CONSTRAINT "customer_opportunity_contacts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "customer_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_opportunity_contacts" ADD CONSTRAINT "customer_opportunity_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "customer_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_opportunity_contacts" ADD CONSTRAINT "customer_opportunity_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_opportunity_contacts" ADD CONSTRAINT "customer_opportunity_contacts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_opportunity_activities" ADD CONSTRAINT "customer_opportunity_activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "customer_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_opportunity_activities" ADD CONSTRAINT "customer_opportunity_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "customer_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_opportunity_activities" ADD CONSTRAINT "customer_opportunity_activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_opportunity_stage_history" ADD CONSTRAINT "customer_opportunity_stage_history_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "customer_opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_opportunity_stage_history" ADD CONSTRAINT "customer_opportunity_stage_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_quotations" ADD CONSTRAINT "sales_quotations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "customer_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "customer_opportunity_stage_history" ("id", "opportunity_id", "from_stage", "to_stage", "changed_by", "changed_at")
SELECT 'initial_' || "id", "id", NULL, "stage", COALESCE("updated_by", "created_by"), "created_at"
FROM "customer_opportunities";

COMMIT;
