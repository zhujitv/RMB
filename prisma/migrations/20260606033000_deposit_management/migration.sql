ALTER TABLE "receivable_orders" ADD COLUMN "deposit_ratio" DECIMAL(8, 4);

UPDATE "receivable_orders"
SET "deposit_ratio" = 0.3000
WHERE "payment_term" = '30%预付款';

UPDATE "receivable_orders"
SET "deposit_ratio" = 0.5000
WHERE "payment_term" = '50%预付款';

UPDATE "receivable_orders"
SET "deposit_ratio" = 1.0000
WHERE "payment_term" = '100%预付款';
