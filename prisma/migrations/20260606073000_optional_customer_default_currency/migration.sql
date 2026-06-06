ALTER TABLE "customers"
ALTER COLUMN "default_currency" DROP DEFAULT,
ALTER COLUMN "default_currency" DROP NOT NULL;

ALTER TABLE "receivable_orders"
ALTER COLUMN "currency" DROP DEFAULT;
