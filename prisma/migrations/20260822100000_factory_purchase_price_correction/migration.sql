CREATE TYPE "FactoryPurchasePriceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "factory_purchase_order_price_corrections" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "purchase_order_item_id" TEXT NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "status" "FactoryPurchasePriceCorrectionStatus" NOT NULL DEFAULT 'PENDING',
  "quantity_snapshot" DECIMAL(18,4) NOT NULL,
  "old_unit_price" DECIMAL(18,6) NOT NULL,
  "new_unit_price" DECIMAL(18,6) NOT NULL,
  "old_amount" DECIMAL(18,2) NOT NULL,
  "new_amount" DECIMAL(18,2) NOT NULL,
  "delta_amount" DECIMAL(18,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "review_remark" TEXT,
  "source_unit_price_type" TEXT NOT NULL DEFAULT 'PURCHASE_ORDER',
  "idempotency_key" TEXT NOT NULL,
  "adjustment_id" TEXT,
  "requested_by" TEXT NOT NULL,
  "reviewed_by" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "factory_purchase_order_price_corrections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fpo_price_corrections_po_sequence_key"
  ON "factory_purchase_order_price_corrections"("purchase_order_id", "sequence_no");

CREATE UNIQUE INDEX "fpo_price_corrections_po_idempotency_key"
  ON "factory_purchase_order_price_corrections"("purchase_order_id", "idempotency_key");

CREATE UNIQUE INDEX "fpo_price_corrections_adjustment_id_key"
  ON "factory_purchase_order_price_corrections"("adjustment_id");

CREATE UNIQUE INDEX "fpo_price_corrections_pending_item_key"
  ON "factory_purchase_order_price_corrections"("purchase_order_item_id")
  WHERE "status" = 'PENDING';

CREATE INDEX "fpo_price_corrections_po_status_time_idx"
  ON "factory_purchase_order_price_corrections"("purchase_order_id", "status", "requested_at");

CREATE INDEX "fpo_price_corrections_item_status_idx"
  ON "factory_purchase_order_price_corrections"("purchase_order_item_id", "status");

CREATE INDEX "fpo_price_corrections_requested_by_idx"
  ON "factory_purchase_order_price_corrections"("requested_by");

CREATE INDEX "fpo_price_corrections_reviewed_by_idx"
  ON "factory_purchase_order_price_corrections"("reviewed_by");

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD CONSTRAINT "fpo_price_corrections_purchase_order_fkey"
  FOREIGN KEY ("purchase_order_id")
  REFERENCES "factory_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD CONSTRAINT "fpo_price_corrections_item_fkey"
  FOREIGN KEY ("purchase_order_item_id", "purchase_order_id")
  REFERENCES "factory_purchase_order_items"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD CONSTRAINT "fpo_price_corrections_adjustment_fkey"
  FOREIGN KEY ("adjustment_id")
  REFERENCES "factory_purchase_order_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD CONSTRAINT "fpo_price_corrections_requested_by_fkey"
  FOREIGN KEY ("requested_by")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD CONSTRAINT "fpo_price_corrections_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD CONSTRAINT "fpo_price_corrections_amount_check"
  CHECK (
    "quantity_snapshot" > 0
    AND "old_unit_price" >= 0
    AND "new_unit_price" >= 0
    AND "delta_amount" = ROUND("new_amount" - "old_amount", 2)
    AND "old_amount" = ROUND("quantity_snapshot" * "old_unit_price", 2)
    AND "new_amount" = ROUND("quantity_snapshot" * "new_unit_price", 2)
  );

CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_price_correction"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase price correction records cannot be deleted';
  END IF;

  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'reviewed factory purchase price correction records are immutable';
  END IF;

  IF (TO_JSONB(NEW) - 'status' - 'review_remark' - 'adjustment_id' - 'reviewed_by' - 'reviewed_at' - 'updated_at')
     IS DISTINCT FROM
     (TO_JSONB(OLD) - 'status' - 'review_remark' - 'adjustment_id' - 'reviewed_by' - 'reviewed_at' - 'updated_at') THEN
    RAISE EXCEPTION 'factory purchase price correction request content is immutable after submission';
  END IF;

  IF NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION 'factory purchase price correction update must review the request';
  END IF;

  IF NEW."reviewed_by" IS NULL OR NEW."reviewed_at" IS NULL THEN
    RAISE EXCEPTION 'factory purchase price correction review requires reviewer and review time';
  END IF;

  IF NEW."status" = 'APPROVED' AND NEW."adjustment_id" IS NULL THEN
    RAISE EXCEPTION 'approved factory purchase price correction requires an adjustment row';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "protect_factory_purchase_order_price_correction_trigger"
  ON "factory_purchase_order_price_corrections";

CREATE TRIGGER "protect_factory_purchase_order_price_correction_trigger"
  BEFORE UPDATE OR DELETE ON "factory_purchase_order_price_corrections"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_price_correction"();
