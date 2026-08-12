-- Business-entity settlement accounts now live in business_entity_bank_accounts.
-- Historical quotation snapshots remain untouched so issued documents stay immutable.
UPDATE "business_entities"
SET "bank_account" = NULL
WHERE "bank_account" IS NOT NULL;
