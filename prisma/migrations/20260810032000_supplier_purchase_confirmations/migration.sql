-- Supplier-specific purchase terms are defaults for future factory purchase
-- orders. The purchase order keeps its own snapshot after it is generated.
ALTER TABLE "suppliers"
  ADD COLUMN "purchase_payment_term" TEXT;

-- Keep the latest response on the purchase order for fast reads, and attach a
-- monotonic sequence so every later delivery-date change has an audit row.
ALTER TABLE "factory_purchase_orders"
  ADD COLUMN "supplier_response_sequence" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "factory_purchase_order_items_id_purchase_order_id_key"
  ON "factory_purchase_order_items"("id", "purchase_order_id");

CREATE TABLE "factory_purchase_order_supplier_responses" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "response_sequence" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "delivery_date" DATE,
  "remark" TEXT,
  "responded_by" TEXT NOT NULL,
  "responded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "factory_purchase_order_supplier_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "factory_purchase_order_supplier_responses_sequence_check" CHECK ("response_sequence" > 0),
  CONSTRAINT "factory_purchase_order_supplier_responses_action_check" CHECK (
    (
      "action" = 'ACCEPTED'
      AND "delivery_date" IS NOT NULL
    )
    OR (
      "action" = 'DELIVERY_PROPOSED'
      AND "delivery_date" IS NOT NULL
      AND NULLIF(BTRIM("remark"), '') IS NOT NULL
    )
    OR (
      "action" = 'REJECTED'
      AND "delivery_date" IS NULL
      AND NULLIF(BTRIM("remark"), '') IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "fpo_supplier_response_po_sequence_key"
  ON "factory_purchase_order_supplier_responses"("purchase_order_id", "response_sequence");
CREATE INDEX "fpo_supplier_response_user_idx"
  ON "factory_purchase_order_supplier_responses"("responded_by");
CREATE INDEX "fpo_supplier_response_po_time_idx"
  ON "factory_purchase_order_supplier_responses"("purchase_order_id", "responded_at");

ALTER TABLE "factory_purchase_order_supplier_responses"
  ADD CONSTRAINT "factory_purchase_order_supplier_responses_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "factory_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_supplier_responses_responded_by_fkey"
  FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the already-existing local responses as the first response event.
UPDATE "factory_purchase_orders"
SET "supplier_response_sequence" = 1
WHERE "status" IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED');

INSERT INTO "factory_purchase_order_supplier_responses" (
  "id",
  "purchase_order_id",
  "response_sequence",
  "action",
  "delivery_date",
  "remark",
  "responded_by",
  "responded_at"
)
SELECT
  'legacy-' || "id",
  "id",
  1,
  "status"::TEXT,
  "supplier_delivery_date",
  "supplier_response_remark",
  "responded_by",
  "responded_at"
FROM "factory_purchase_orders"
WHERE "status" IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED');

-- Prices supplied after dispatch are stored separately from the immutable
-- dispatched purchase-order items. This preserves the original outbound
-- version while giving downstream costing an effective confirmed price.
CREATE TABLE "factory_purchase_order_supplier_prices" (
  "id" TEXT NOT NULL,
  "purchase_order_id" TEXT NOT NULL,
  "purchase_order_item_id" TEXT NOT NULL,
  "supplier_response_id" TEXT NOT NULL,
  "unit_price" DECIMAL(18,6) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "confirmed_by" TEXT NOT NULL,
  "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "factory_purchase_order_supplier_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "factory_purchase_order_supplier_prices_unit_price_check" CHECK ("unit_price" >= 0),
  CONSTRAINT "factory_purchase_order_supplier_prices_amount_check" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "fpo_supplier_price_item_po_key"
  ON "factory_purchase_order_supplier_prices"("purchase_order_item_id", "purchase_order_id");
CREATE INDEX "fpo_supplier_price_po_idx"
  ON "factory_purchase_order_supplier_prices"("purchase_order_id");
CREATE INDEX "fpo_supplier_price_response_idx"
  ON "factory_purchase_order_supplier_prices"("supplier_response_id");
CREATE INDEX "fpo_supplier_price_user_idx"
  ON "factory_purchase_order_supplier_prices"("confirmed_by");

ALTER TABLE "factory_purchase_order_supplier_prices"
  ADD CONSTRAINT "factory_purchase_order_supplier_prices_purchase_order_item_id_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_item_id", "purchase_order_id")
  REFERENCES "factory_purchase_order_items"("id", "purchase_order_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_supplier_prices_supplier_response_id_fkey"
  FOREIGN KEY ("supplier_response_id") REFERENCES "factory_purchase_order_supplier_responses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "factory_purchase_order_supplier_prices_confirmed_by_fkey"
  FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "factory_purchase_orders"
  DROP CONSTRAINT "factory_purchase_orders_response_state_check",
  ADD CONSTRAINT "factory_purchase_orders_response_state_check" CHECK (
    (
      "status" IN ('DRAFT', 'DISPATCHED')
      AND "supplier_response_sequence" = 0
      AND "supplier_delivery_date" IS NULL
      AND "supplier_response_remark" IS NULL
      AND "responded_at" IS NULL
      AND "responded_by" IS NULL
    )
    OR (
      "status" = 'ACCEPTED'
      AND "supplier_response_sequence" > 0
      AND "supplier_delivery_date" IS NOT NULL
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    )
    OR (
      "status" = 'DELIVERY_PROPOSED'
      AND "supplier_response_sequence" > 0
      AND "supplier_delivery_date" IS NOT NULL
      AND NULLIF(BTRIM("supplier_response_remark"), '') IS NOT NULL
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    )
    OR (
      "status" = 'REJECTED'
      AND "supplier_response_sequence" > 0
      AND NULLIF(BTRIM("supplier_response_remark"), '') IS NOT NULL
      AND "responded_at" IS NOT NULL
      AND "responded_by" IS NOT NULL
    )
    OR "status" = 'VOIDED'
  );

-- The matching history row must be inserted in the same transaction before
-- the latest-response fields can advance. Technical email updates remain
-- possible because they do not touch response fields or the sequence.
CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_status_transition"() RETURNS trigger AS $$
DECLARE
  response_changed BOOLEAN;
BEGIN
  response_changed :=
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."supplier_response_sequence" IS DISTINCT FROM OLD."supplier_response_sequence"
    OR NEW."supplier_delivery_date" IS DISTINCT FROM OLD."supplier_delivery_date"
    OR NEW."supplier_response_remark" IS DISTINCT FROM OLD."supplier_response_remark"
    OR NEW."responded_at" IS DISTINCT FROM OLD."responded_at"
    OR NEW."responded_by" IS DISTINCT FROM OLD."responded_by";

  IF OLD."status" = 'DRAFT'
    AND NEW."status" NOT IN ('DRAFT', 'DISPATCHED', 'VOIDED') THEN
    RAISE EXCEPTION 'factory purchase order must be dispatched before supplier response';
  END IF;

  IF OLD."status" = 'DISPATCHED'
    AND NEW."status" NOT IN ('DISPATCHED', 'ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED', 'VOIDED') THEN
    RAISE EXCEPTION 'invalid dispatched factory purchase order transition';
  END IF;

  IF OLD."status" = 'REJECTED' THEN
    IF NEW."status" NOT IN ('REJECTED', 'VOIDED') THEN
      RAISE EXCEPTION 'rejected supplier response is terminal';
    END IF;
    IF NEW."status" = 'REJECTED' AND response_changed THEN
      RAISE EXCEPTION 'rejected supplier response is immutable';
    END IF;
  END IF;

  IF OLD."status" = 'ACCEPTED'
    AND NEW."status" NOT IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'VOIDED') THEN
    RAISE EXCEPTION 'accepted supplier response can only propose a later delivery change';
  END IF;

  IF OLD."status" = 'DELIVERY_PROPOSED'
    AND NEW."status" NOT IN ('DELIVERY_PROPOSED', 'VOIDED') THEN
    RAISE EXCEPTION 'delivery proposal can only be replaced by another delivery proposal';
  END IF;

  IF NEW."status" = 'VOIDED' THEN
    RETURN NEW;
  END IF;

  IF response_changed AND NEW."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED', 'REJECTED') THEN
    IF NEW."supplier_response_sequence" <> OLD."supplier_response_sequence" + 1 THEN
      RAISE EXCEPTION 'supplier response sequence must advance exactly once';
    END IF;
    IF OLD."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED') THEN
      IF NEW."status" <> 'DELIVERY_PROPOSED' THEN
        RAISE EXCEPTION 'later supplier responses may only change delivery date';
      END IF;
      IF NEW."supplier_delivery_date" IS NOT DISTINCT FROM OLD."supplier_delivery_date" THEN
        RAISE EXCEPTION 'later supplier delivery date must change';
      END IF;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "factory_purchase_order_supplier_responses" response
      WHERE response."purchase_order_id" = NEW."id"
        AND response."response_sequence" = NEW."supplier_response_sequence"
        AND response."action" = NEW."status"::TEXT
        AND response."delivery_date" IS NOT DISTINCT FROM NEW."supplier_delivery_date"
        AND response."remark" IS NOT DISTINCT FROM NEW."supplier_response_remark"
        AND response."responded_by" = NEW."responded_by"
        AND response."responded_at" = NEW."responded_at"
    ) THEN
      RAISE EXCEPTION 'supplier response history row is required';
    END IF;
  ELSIF OLD."status" IN ('ACCEPTED', 'DELIVERY_PROPOSED') AND response_changed THEN
    RAISE EXCEPTION 'supplier response fields require a new delivery proposal';
  END IF;

  IF OLD."status" = 'VOIDED' AND NEW."status" <> 'VOIDED' THEN
    RAISE EXCEPTION 'voided factory purchase order cannot be restored';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "protect_factory_purchase_order_supplier_response"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'supplier response history is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_supplier_responses_immutability_guard"
  BEFORE UPDATE OR DELETE ON "factory_purchase_order_supplier_responses"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_supplier_response"();

CREATE FUNCTION "validate_factory_purchase_order_supplier_price"() RETURNS trigger AS $$
DECLARE
  parent_status "FactoryPurchaseOrderStatus";
  original_unit_price DECIMAL(18,6);
  allocated_quantity DECIMAL(18,4);
BEGIN
  SELECT purchase_order."status", item."purchase_unit_price", item."allocated_quantity"
  INTO parent_status, original_unit_price, allocated_quantity
  FROM "factory_purchase_order_items" item
  JOIN "factory_purchase_orders" purchase_order ON purchase_order."id" = item."purchase_order_id"
  JOIN "factory_purchase_order_supplier_responses" response
    ON response."id" = NEW."supplier_response_id"
    AND response."purchase_order_id" = NEW."purchase_order_id"
    AND response."action" <> 'REJECTED'
  WHERE item."id" = NEW."purchase_order_item_id"
    AND item."purchase_order_id" = NEW."purchase_order_id"
  FOR KEY SHARE OF purchase_order, item;

  IF NOT FOUND OR parent_status NOT IN ('DISPATCHED', 'ACCEPTED', 'DELIVERY_PROPOSED') THEN
    RAISE EXCEPTION 'supplier price can only confirm an active dispatched purchase order item';
  END IF;
  IF original_unit_price IS NOT NULL THEN
    RAISE EXCEPTION 'supplier price cannot replace the dispatched purchase unit price';
  END IF;
  IF NEW."amount" <> ROUND(allocated_quantity * NEW."unit_price", 2) THEN
    RAISE EXCEPTION 'supplier price amount must equal quantity multiplied by unit price';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_supplier_prices_insert_guard"
  BEFORE INSERT ON "factory_purchase_order_supplier_prices"
  FOR EACH ROW EXECUTE FUNCTION "validate_factory_purchase_order_supplier_price"();

CREATE FUNCTION "protect_factory_purchase_order_supplier_price"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'confirmed supplier price is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "factory_purchase_order_supplier_prices_immutability_guard"
  BEFORE UPDATE OR DELETE ON "factory_purchase_order_supplier_prices"
  FOR EACH ROW EXECUTE FUNCTION "protect_factory_purchase_order_supplier_price"();
