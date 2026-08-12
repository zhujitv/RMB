ALTER TYPE "SalesQuotationStatus" ADD VALUE IF NOT EXISTS 'SENT';
ALTER TYPE "SalesQuotationStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "SalesQuotationStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

BEGIN;

CREATE TYPE "SalesQuotationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TYPE "SalesQuotationResponseStatus" AS ENUM ('ACCEPTED', 'REJECTED');

ALTER TABLE "sales_quotations"
  ADD COLUMN "business_entity_id" TEXT;

ALTER TABLE "sales_quotation_versions"
  ADD COLUMN "business_entity_name_snapshot" TEXT,
  ADD COLUMN "business_entity_short_name_snapshot" TEXT,
  ADD COLUMN "seller_name_en_snapshot" TEXT,
  ADD COLUMN "seller_address_snapshot" TEXT,
  ADD COLUMN "seller_email_snapshot" TEXT,
  ADD COLUMN "seller_phone_snapshot" TEXT,
  ADD COLUMN "seller_website_snapshot" TEXT,
  ADD COLUMN "document_template_version" TEXT NOT NULL DEFAULT 'PI_V1';

CREATE TABLE "sales_quotation_deliveries" (
  "id" TEXT NOT NULL,
  "quotation_id" TEXT NOT NULL,
  "quotation_version_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" "SalesQuotationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "recipient_emails" JSONB NOT NULL,
  "cc_emails" JSONB,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "attachment_file_asset_id" TEXT,
  "attachment_file_name" TEXT,
  "outbox_id" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "sent_by" TEXT,
  "sent_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "response_status" "SalesQuotationResponseStatus",
  "response_reason" TEXT,
  "responded_by" TEXT,
  "responded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_quotation_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_quotation_deliveries_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX "sales_quotations_business_entity_id_idx"
  ON "sales_quotations"("business_entity_id");
CREATE UNIQUE INDEX "sales_quotation_deliveries_idempotency_key_key"
  ON "sales_quotation_deliveries"("idempotency_key");
CREATE UNIQUE INDEX "sales_quotation_deliveries_outbox_id_key"
  ON "sales_quotation_deliveries"("outbox_id");
CREATE INDEX "sales_quotation_deliveries_quotation_id_created_at_idx"
  ON "sales_quotation_deliveries"("quotation_id", "created_at");
CREATE INDEX "sales_quotation_deliveries_quotation_version_id_status_idx"
  ON "sales_quotation_deliveries"("quotation_version_id", "status");
CREATE INDEX "sales_quotation_deliveries_status_created_at_idx"
  ON "sales_quotation_deliveries"("status", "created_at");
CREATE INDEX "sales_quotation_deliveries_sent_by_idx"
  ON "sales_quotation_deliveries"("sent_by");
CREATE INDEX "sales_quotation_deliveries_responded_by_idx"
  ON "sales_quotation_deliveries"("responded_by");

ALTER TABLE "sales_quotations"
  ADD CONSTRAINT "sales_quotations_business_entity_id_fkey"
  FOREIGN KEY ("business_entity_id") REFERENCES "business_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_deliveries"
  ADD CONSTRAINT "sales_quotation_deliveries_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "sales_quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_deliveries"
  ADD CONSTRAINT "sales_quotation_deliveries_quotation_version_id_fkey"
  FOREIGN KEY ("quotation_version_id") REFERENCES "sales_quotation_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_deliveries"
  ADD CONSTRAINT "sales_quotation_deliveries_sent_by_fkey"
  FOREIGN KEY ("sent_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_quotation_deliveries"
  ADD CONSTRAINT "sales_quotation_deliveries_responded_by_fkey"
  FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
