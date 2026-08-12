BEGIN;

CREATE TABLE "business_entity_bank_accounts" (
  "id" TEXT NOT NULL,
  "business_entity_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "beneficiary_name" TEXT NOT NULL,
  "beneficiary_address" TEXT NOT NULL,
  "bank_name" TEXT NOT NULL,
  "account_number" TEXT NOT NULL,
  "swift_code" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_entity_bank_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_entity_bank_accounts_currency_check" CHECK ("currency" IN ('CNY', 'USD')),
  CONSTRAINT "business_entity_bank_accounts_swift_length_check" CHECK (char_length("swift_code") IN (8, 11)),
  CONSTRAINT "business_entity_bank_accounts_required_text_check" CHECK (
    char_length(btrim("beneficiary_name")) > 0
    AND char_length(btrim("beneficiary_address")) > 0
    AND char_length(btrim("bank_name")) > 0
    AND char_length(btrim("account_number")) > 0
  ),
  CONSTRAINT "business_entity_bank_accounts_business_entity_id_fkey"
    FOREIGN KEY ("business_entity_id")
    REFERENCES "business_entities"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "business_entity_bank_accounts_business_entity_id_currency_key"
  ON "business_entity_bank_accounts"("business_entity_id", "currency");

CREATE INDEX "business_entity_bank_accounts_currency_idx"
  ON "business_entity_bank_accounts"("currency");

COMMIT;
