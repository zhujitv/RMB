ALTER TABLE "customers" ADD COLUMN "salesperson_user_id" TEXT;
CREATE INDEX "customers_salesperson_user_id_idx" ON "customers"("salesperson_user_id");
ALTER TABLE "customers" ADD CONSTRAINT "customers_salesperson_user_id_fkey" FOREIGN KEY ("salesperson_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "receivable_orders" ADD COLUMN "customer_name_snapshot" TEXT;
UPDATE "receivable_orders" AS ro
SET "customer_name_snapshot" = COALESCE(c."name", '')
FROM "customers" AS c
WHERE ro."customer_id" = c."id";
UPDATE "receivable_orders"
SET "customer_name_snapshot" = ''
WHERE "customer_name_snapshot" IS NULL;
ALTER TABLE "receivable_orders" ALTER COLUMN "customer_name_snapshot" SET NOT NULL;

ALTER TABLE "receivable_orders" ADD COLUMN "salesperson_user_id" TEXT;
UPDATE "receivable_orders"
SET "salesperson_user_id" = "salesperson_id"
WHERE "salesperson_user_id" IS NULL AND "salesperson_id" IS NOT NULL;
CREATE INDEX "receivable_orders_salesperson_user_id_idx" ON "receivable_orders"("salesperson_user_id");
ALTER TABLE "receivable_orders" ADD CONSTRAINT "receivable_orders_salesperson_user_id_fkey" FOREIGN KEY ("salesperson_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "customers" AS c
SET "salesperson_user_id" = owner."salesperson_user_id"
FROM (
  SELECT DISTINCT ON ("customer_id")
    "customer_id",
    "salesperson_user_id"
  FROM "receivable_orders"
  WHERE "deleted_at" IS NULL AND "salesperson_user_id" IS NOT NULL
  ORDER BY "customer_id", "created_at" DESC
) AS owner
WHERE c."id" = owner."customer_id" AND c."salesperson_user_id" IS NULL;

UPDATE "receivable_orders"
SET "bl_no" = ''
WHERE "bl_no" IS NULL;
ALTER TABLE "receivable_orders" ALTER COLUMN "bl_no" SET NOT NULL;
