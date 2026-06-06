CREATE TYPE "PaymentTermType" AS ENUM ('COPY_BL', 'OA', 'AFTER_ARRIVAL', 'INSTALLMENT');

ALTER TABLE "receivable_orders" ADD COLUMN "payment_term_type" "PaymentTermType";
ALTER TABLE "receivable_orders" ADD COLUMN "expected_arrival_date" DATE;
ALTER TABLE "receivable_orders" ADD COLUMN "expected_shipment_date" DATE;
ALTER TABLE "receivable_orders" ADD COLUMN "bl_date" DATE;
ALTER TABLE "receivable_orders" ADD COLUMN "payment_installments" JSONB;

CREATE INDEX "receivable_orders_payment_term_type_idx" ON "receivable_orders"("payment_term_type");
