CREATE TABLE "exchange_rates" (
  "id" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "rate_to_cny" DECIMAL(18, 6) NOT NULL,
  "rate_date" DATE NOT NULL,
  "source" TEXT NOT NULL,
  "rate_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exchange_rates_currency_rate_date_source_rate_type_key"
  ON "exchange_rates"("currency", "rate_date", "source", "rate_type");
CREATE INDEX "exchange_rates_currency_rate_date_idx" ON "exchange_rates"("currency", "rate_date");

CREATE TABLE "system_settings" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "receivable_orders" ADD COLUMN "exchange_rate_date" DATE;
ALTER TABLE "receivable_orders" ADD COLUMN "exchange_rate_source" TEXT;
ALTER TABLE "receivable_orders" ADD COLUMN "exchange_rate_type" TEXT;

ALTER TABLE "payments" ADD COLUMN "exchange_rate_date" DATE;
ALTER TABLE "payments" ADD COLUMN "exchange_rate_source" TEXT;
ALTER TABLE "payments" ADD COLUMN "exchange_rate_type" TEXT;

ALTER TABLE "order_costs" ADD COLUMN "exchange_rate_date" DATE;
ALTER TABLE "order_costs" ADD COLUMN "exchange_rate_source" TEXT;
ALTER TABLE "order_costs" ADD COLUMN "exchange_rate_type" TEXT;

UPDATE "receivable_orders"
SET
  "exchange_rate_date" = COALESCE("created_at"::date, CURRENT_DATE),
  "exchange_rate_source" = '历史录入',
  "exchange_rate_type" = '历史录入'
WHERE "exchange_rate_date" IS NULL;

UPDATE "payments"
SET
  "exchange_rate_date" = COALESCE("payment_date", "created_at"::date, CURRENT_DATE),
  "exchange_rate_source" = '历史录入',
  "exchange_rate_type" = '历史录入'
WHERE "exchange_rate_date" IS NULL;

UPDATE "order_costs"
SET
  "exchange_rate_date" = COALESCE("payment_date", "created_at"::date, CURRENT_DATE),
  "exchange_rate_source" = '历史录入',
  "exchange_rate_type" = '历史录入'
WHERE "exchange_rate_date" IS NULL;

INSERT INTO "system_settings" ("key", "value", "updated_at")
VALUES (
  'exchange_rate',
  '{"source":"中国银行","rateType":"现汇买入价","autoUpdate":true,"allowManualEdit":true}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
