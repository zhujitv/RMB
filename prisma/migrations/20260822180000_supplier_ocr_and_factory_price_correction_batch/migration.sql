BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

LOCK TABLE "ocr_tasks" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "ocr_tasks"
  ADD COLUMN "manual_result_json" JSONB,
  ADD COLUMN "manual_validation_json" JSONB,
  ADD COLUMN "review_revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "manual_edited_by_id" TEXT,
  ADD COLUMN "manual_edited_at" TIMESTAMP(3);

ALTER TABLE "ocr_tasks"
  ADD CONSTRAINT "ocr_tasks_review_revision_check"
  CHECK ("review_revision" > 0),
  ADD CONSTRAINT "ocr_tasks_confirmation_state_check"
  CHECK (
    ("confirmed_at" IS NULL AND "confirmed_by_id" IS NULL)
    OR ("confirmed_at" IS NOT NULL AND "confirmed_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "ocr_tasks_manual_review_state_check"
  CHECK (
    (
      "manual_result_json" IS NULL
      AND "manual_validation_json" IS NULL
      AND "manual_edited_by_id" IS NULL
      AND "manual_edited_at" IS NULL
    ) OR (
      "manual_result_json" IS NOT NULL
      AND "manual_validation_json" IS NOT NULL
      AND "manual_edited_by_id" IS NOT NULL
      AND "manual_edited_at" IS NOT NULL
    )
  );

ALTER TABLE "ocr_tasks"
  ADD CONSTRAINT "ocr_tasks_manual_edited_by_fkey"
  FOREIGN KEY ("manual_edited_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ocr_tasks_manual_edited_by_idx"
  ON "ocr_tasks"("manual_edited_by_id");

CREATE OR REPLACE FUNCTION "protect_ocr_task_original_and_manual_review"()
RETURNS trigger AS $$
DECLARE
  manual_changed BOOLEAN;
BEGIN
  IF OLD."result_json" IS NOT NULL
    AND NEW."result_json" IS DISTINCT FROM OLD."result_json" THEN
    RAISE EXCEPTION 'original OCR result cannot be overwritten';
  END IF;

  IF OLD."document_id" IS DISTINCT FROM NEW."document_id"
    OR OLD."request_id" IS DISTINCT FROM NEW."request_id"
    OR OLD."order_id" IS DISTINCT FROM NEW."order_id"
    OR OLD."supplier_id" IS DISTINCT FROM NEW."supplier_id"
    OR OLD."document_type" IS DISTINCT FROM NEW."document_type"
    OR OLD."module" IS DISTINCT FROM NEW."module" THEN
    RAISE EXCEPTION 'OCR task source identity is immutable';
  END IF;

  manual_changed := NEW."manual_result_json" IS DISTINCT FROM OLD."manual_result_json"
    OR NEW."manual_validation_json" IS DISTINCT FROM OLD."manual_validation_json"
    OR NEW."manual_edited_by_id" IS DISTINCT FROM OLD."manual_edited_by_id"
    OR NEW."manual_edited_at" IS DISTINCT FROM OLD."manual_edited_at";

  IF OLD."confirmed_at" IS NOT NULL AND (
    manual_changed
    OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
    OR NEW."confirmed_by_id" IS DISTINCT FROM OLD."confirmed_by_id"
  ) THEN
    RAISE EXCEPTION 'confirmed OCR review cannot be reopened or changed';
  END IF;
  IF OLD."confirmed_at" IS NULL AND NEW."confirmed_at" IS NOT NULL AND manual_changed THEN
    RAISE EXCEPTION 'OCR review confirmation and manual changes must be separate updates';
  END IF;
  IF manual_changed AND NEW."review_revision" IS DISTINCT FROM OLD."review_revision" + 1 THEN
    RAISE EXCEPTION 'OCR manual review must advance revision exactly once';
  END IF;
  IF NOT manual_changed AND NEW."review_revision" IS DISTINCT FROM OLD."review_revision" THEN
    RAISE EXCEPTION 'OCR review revision can only change with a manual review';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "protect_ocr_task_original_and_manual_review_trigger"
  BEFORE UPDATE ON "ocr_tasks"
  FOR EACH ROW EXECUTE FUNCTION "protect_ocr_task_original_and_manual_review"();

LOCK TABLE "factory_purchase_orders",
           "factory_purchase_order_payments",
           "factory_purchase_order_adjustments",
           "factory_purchase_order_settlements",
           "factory_purchase_order_price_corrections",
           "order_costs"
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "factory_purchase_order_price_corrections"
  ADD COLUMN "batch_id" TEXT,
  ADD COLUMN "batch_line_no" INTEGER,
  ADD COLUMN "batch_line_count" INTEGER,
  ADD CONSTRAINT "fpo_price_corrections_batch_shape_check" CHECK (
    (
      "batch_id" IS NULL
      AND "batch_line_no" IS NULL
      AND "batch_line_count" IS NULL
    ) OR (
      "batch_id" IS NOT NULL
      AND LENGTH("batch_id") BETWEEN 1 AND 200
      AND "batch_line_no" BETWEEN 1 AND 100
      AND "batch_line_count" BETWEEN 1 AND 100
      AND "batch_line_no" <= "batch_line_count"
    )
  );

CREATE UNIQUE INDEX "fpo_price_corrections_po_batch_line_key"
  ON "factory_purchase_order_price_corrections" (
    "purchase_order_id", "batch_id", "batch_line_no"
  );

CREATE INDEX "fpo_price_corrections_po_batch_status_idx"
  ON "factory_purchase_order_price_corrections" (
    "purchase_order_id", "batch_id", "status"
  );

-- An adjustment row is still linked one-to-one to a correction line.  After
-- settlement, batch lines are permitted only while their request is pending;
-- the deferred guard below verifies the complete batch at COMMIT.
CREATE OR REPLACE FUNCTION "guard_factory_purchase_ledger_after_settlement"()
RETURNS trigger AS $$
DECLARE
  settlement_status "FactoryPurchaseSettlementStatus";
  settlement_final NUMERIC(18,2);
  current_net_paid NUMERIC(18,2);
  target_purchase_order_id TEXT;
  correction RECORD;
BEGIN
  target_purchase_order_id := CASE
    WHEN TG_OP = 'INSERT' THEN NEW."purchase_order_id"
    ELSE OLD."purchase_order_id"
  END;

  SELECT settlement."status", settlement."final_payable_amount"
  INTO settlement_status, settlement_final
  FROM "factory_purchase_order_settlements" settlement
  WHERE settlement."purchase_order_id" = target_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF TG_TABLE_NAME = 'factory_purchase_order_payments' AND TG_OP = 'INSERT' THEN
      IF NEW."kind" = 'REFUND' THEN
        RAISE EXCEPTION 'factory purchase refund requires an existing settlement waiting for refund';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'factory_purchase_order_adjustments' THEN
    IF TG_OP <> 'INSERT'
      OR NEW."source_type" IS DISTINCT FROM 'PURCHASE_PRICE_CORRECTION'
      OR NEW."source_id" IS NULL
      OR NEW."kind" <> 'OTHER'
      OR NEW."status" <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'factory purchase order adjustments are frozen after final settlement';
    END IF;

    SELECT price_correction."purchase_order_id", price_correction."status",
           price_correction."currency", price_correction."delta_amount",
           price_correction."batch_id", price_correction."batch_line_no",
           price_correction."batch_line_count"
    INTO correction
    FROM "factory_purchase_order_price_corrections" price_correction
    WHERE price_correction."id" = NEW."source_id"
    FOR UPDATE;

    IF NOT FOUND
      OR correction."purchase_order_id" IS DISTINCT FROM NEW."purchase_order_id"
      OR correction."status" <> 'PENDING'
      OR correction."currency" IS DISTINCT FROM NEW."currency"
      OR NEW."amount" IS DISTINCT FROM ABS(correction."delta_amount")
      OR NEW."direction"::TEXT IS DISTINCT FROM (
        CASE WHEN correction."delta_amount" > 0 THEN 'INCREASE' ELSE 'DECREASE' END
      )
      OR (
        correction."batch_id" IS NOT NULL
        AND (
          correction."batch_line_no" IS NULL
          OR correction."batch_line_count" IS NULL
          OR correction."batch_line_no" > correction."batch_line_count"
        )
      ) THEN
      RAISE EXCEPTION 'post-settlement adjustment must match one pending purchase price correction';
    END IF;
    RETURN NEW;
  END IF;

  current_net_paid := "factory_purchase_order_net_paid"(target_purchase_order_id);
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'post-settlement purchase payment must be confirmed';
    END IF;
    IF NEW."kind" = 'BALANCE'
      AND settlement_status = 'PENDING_PAYMENT'
      AND current_net_paid + NEW."amount" <= settlement_final THEN
      RETURN NEW;
    END IF;
    IF NEW."kind" = 'REFUND'
      AND settlement_status = 'PENDING_REFUND'
      AND current_net_paid - NEW."amount" >= settlement_final THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'payment kind or amount does not match the pending settlement action';
  END IF;

  IF NEW."status" = 'VOIDED'
    AND settlement_status <> 'SETTLED'
    AND OLD."kind" IN ('BALANCE', 'REFUND') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'closed factory purchase payment evidence cannot be changed';
END;
$$ LANGUAGE plpgsql;

-- Reconcile batch shape, line backlinks, the one leader snapshot, settlement,
-- payments and the derived cost at COMMIT.  This allows row-by-row writes
-- inside one transaction but rejects every partial batch.
CREATE OR REPLACE FUNCTION "assert_factory_purchase_settlement_commit_consistency"()
RETURNS trigger AS $$
DECLARE
  target_purchase_order_id TEXT;
  old_row JSONB;
  new_row JSONB;
  settlement_record RECORD;
  settlement_cost RECORD;
  linked_correction RECORD;
  snapshot_correction RECORD;
  event_batch_id TEXT;
  event_batch_line_count INTEGER;
  event_status "FactoryPurchasePriceCorrectionStatus";
  expected_increase NUMERIC(18,2);
  expected_decrease NUMERIC(18,2);
  expected_final NUMERIC(18,2);
  net_paid NUMERIC(18,2);
  latest_payment_date DATE;
  expected_status "FactoryPurchaseSettlementStatus";
  expected_payment_status TEXT;
  expected_paid BOOLEAN;
  expected_payment_date DATE;
  minimum_running_paid NUMERIC(18,2);
  linked_correction_adjustment BOOLEAN := FALSE;
  batch_row_count INTEGER;
  batch_line_count INTEGER;
  batch_distinct_line_count INTEGER;
  batch_min_line INTEGER;
  batch_max_line INTEGER;
  batch_status_count INTEGER;
  batch_reason_count INTEGER;
  batch_currency_count INTEGER;
  batch_requester_count INTEGER;
  batch_reviewer_count INTEGER;
  batch_reviewed_at_count INTEGER;
  batch_adjustment_count INTEGER;
  batch_snapshot_count INTEGER;
  batch_nonleader_snapshot_count INTEGER;
  batch_delta NUMERIC(18,2);
  batch_increase NUMERIC(18,2);
  batch_decrease NUMERIC(18,2);
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := TO_JSONB(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := TO_JSONB(NEW); END IF;

  target_purchase_order_id := CASE
    WHEN TG_TABLE_NAME IN (
      'factory_purchase_order_settlements',
      'factory_purchase_order_payments',
      'factory_purchase_order_adjustments',
      'factory_purchase_order_price_corrections'
    ) AND TG_OP = 'DELETE' THEN old_row ->> 'purchase_order_id'
    WHEN TG_TABLE_NAME IN (
      'factory_purchase_order_settlements',
      'factory_purchase_order_payments',
      'factory_purchase_order_adjustments',
      'factory_purchase_order_price_corrections'
    ) THEN new_row ->> 'purchase_order_id'
    WHEN TG_TABLE_NAME = 'factory_purchase_orders' AND TG_OP = 'DELETE'
      THEN old_row ->> 'id'
    WHEN TG_TABLE_NAME = 'factory_purchase_orders'
      THEN new_row ->> 'id'
    WHEN TG_TABLE_NAME = 'order_costs' AND TG_OP = 'DELETE'
      AND old_row ->> 'source_type' = 'FACTORY_PURCHASE_SETTLEMENT'
      THEN old_row ->> 'source_id'
    WHEN TG_TABLE_NAME = 'order_costs' AND TG_OP <> 'DELETE'
      AND new_row ->> 'source_type' = 'FACTORY_PURCHASE_SETTLEMENT'
      THEN new_row ->> 'source_id'
    WHEN TG_TABLE_NAME = 'order_costs' AND TG_OP = 'UPDATE'
      AND old_row ->> 'source_type' = 'FACTORY_PURCHASE_SETTLEMENT'
      THEN old_row ->> 'source_id'
    ELSE NULL
  END;
  IF target_purchase_order_id IS NULL THEN RETURN NULL; END IF;

  -- Every explicit batch must be complete and end the transaction in one
  -- status with one reviewer/time. Pending batches have neither effects nor
  -- review data; terminal batches may never be partly approved/rejected.
  IF TG_TABLE_NAME = 'factory_purchase_order_price_corrections' THEN
    SELECT price_correction."batch_id", price_correction."batch_line_count"
    INTO event_batch_id, event_batch_line_count
    FROM "factory_purchase_order_price_corrections" price_correction
    WHERE price_correction."id" = COALESCE(new_row ->> 'id', old_row ->> 'id');

    IF FOUND AND event_batch_id IS NOT NULL THEN
      SELECT
        COUNT(*)::INTEGER,
        MIN(price_correction."batch_line_count")::INTEGER,
        COUNT(DISTINCT price_correction."batch_line_no")::INTEGER,
        MIN(price_correction."batch_line_no")::INTEGER,
        MAX(price_correction."batch_line_no")::INTEGER,
        COUNT(DISTINCT price_correction."status")::INTEGER,
        COUNT(DISTINCT price_correction."reason")::INTEGER,
        COUNT(DISTINCT price_correction."currency")::INTEGER,
        COUNT(DISTINCT price_correction."requested_by")::INTEGER,
        COUNT(DISTINCT price_correction."reviewed_by")::INTEGER,
        COUNT(DISTINCT price_correction."reviewed_at")::INTEGER,
        COUNT(price_correction."adjustment_id")::INTEGER,
        COUNT(*) FILTER (WHERE price_correction."settlement_revision_after" IS NOT NULL)::INTEGER,
        COUNT(*) FILTER (WHERE price_correction."batch_line_no" <> 1 AND (
          price_correction."settlement_final_payable_before" IS NOT NULL
          OR price_correction."settlement_final_payable_after" IS NOT NULL
          OR price_correction."settlement_revision_before" IS NOT NULL
          OR price_correction."settlement_revision_after" IS NOT NULL
        ))::INTEGER
      INTO batch_row_count, batch_line_count, batch_distinct_line_count,
           batch_min_line, batch_max_line, batch_status_count,
           batch_reason_count, batch_currency_count, batch_requester_count,
           batch_reviewer_count, batch_reviewed_at_count,
           batch_adjustment_count, batch_snapshot_count,
           batch_nonleader_snapshot_count
      FROM "factory_purchase_order_price_corrections" price_correction
      WHERE price_correction."purchase_order_id" = target_purchase_order_id
        AND price_correction."batch_id" = event_batch_id;

      IF batch_row_count <> event_batch_line_count
        OR batch_line_count <> event_batch_line_count
        OR batch_distinct_line_count <> event_batch_line_count
        OR batch_min_line <> 1
        OR batch_max_line <> event_batch_line_count
        OR batch_status_count <> 1
        OR batch_reason_count <> 1
        OR batch_currency_count <> 1
        OR batch_requester_count <> 1
        OR batch_nonleader_snapshot_count <> 0 THEN
        RAISE EXCEPTION 'purchase price correction batch must commit as one complete immutable set';
      END IF;

      SELECT price_correction."status"
      INTO event_status
      FROM "factory_purchase_order_price_corrections" price_correction
      WHERE price_correction."purchase_order_id" = target_purchase_order_id
        AND price_correction."batch_id" = event_batch_id
      LIMIT 1;
      IF event_status = 'PENDING' THEN
        IF batch_reviewer_count <> 0 OR batch_reviewed_at_count <> 0
          OR batch_adjustment_count <> 0 OR batch_snapshot_count <> 0 THEN
          RAISE EXCEPTION 'pending purchase price correction batch cannot carry review effects';
        END IF;
      ELSIF event_status = 'REJECTED' THEN
        IF batch_reviewer_count <> 1 OR batch_reviewed_at_count <> 1
          OR batch_adjustment_count <> 0 OR batch_snapshot_count <> 0 THEN
          RAISE EXCEPTION 'rejected purchase price correction batch must be reviewed without effects';
        END IF;
      ELSIF event_status = 'APPROVED' THEN
        IF batch_reviewer_count <> 1 OR batch_reviewed_at_count <> 1
          OR batch_adjustment_count <> event_batch_line_count THEN
          RAISE EXCEPTION 'approved purchase price correction batch requires all line adjustments';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Validate every adjustment/backlink before settlement lookup so a direct
  -- pre-settlement adjustment cannot bypass the batch guard.
  IF TG_TABLE_NAME = 'factory_purchase_order_adjustments'
    AND TG_OP = 'INSERT'
    AND new_row ->> 'source_type' = 'PURCHASE_PRICE_CORRECTION' THEN
    linked_correction_adjustment := TRUE;
    SELECT price_correction."status", price_correction."adjustment_id",
           price_correction."batch_id", price_correction."batch_line_no",
           price_correction."batch_line_count"
    INTO linked_correction
    FROM "factory_purchase_order_price_corrections" price_correction
    WHERE price_correction."id" = new_row ->> 'source_id';
    IF NOT FOUND
      OR linked_correction."status" <> 'APPROVED'
      OR linked_correction."adjustment_id" IS DISTINCT FROM new_row ->> 'id' THEN
      RAISE EXCEPTION 'purchase price correction adjustment must commit an approved backlink';
    END IF;

    SELECT leader.*
    INTO snapshot_correction
    FROM "factory_purchase_order_price_corrections" leader
    WHERE leader."purchase_order_id" = target_purchase_order_id
      AND (
        (linked_correction."batch_id" IS NULL AND leader."id" = new_row ->> 'source_id')
        OR (
          linked_correction."batch_id" IS NOT NULL
          AND leader."batch_id" = linked_correction."batch_id"
          AND leader."batch_line_no" = 1
        )
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'purchase price correction batch requires one leader row';
    END IF;
  END IF;

  SELECT settlement."status", settlement."base_amount",
         settlement."increase_amount", settlement."decrease_amount",
         settlement."delay_penalty_amount", settlement."final_payable_amount",
         settlement."paid_amount_at_settlement", settlement."exchange_rate",
         settlement."settled_at", settlement."settled_by", settlement."revision",
         purchase_order."status" AS purchase_order_status,
         purchase_order."actual_delivery_date"
  INTO settlement_record
  FROM "factory_purchase_order_settlements" settlement
  JOIN "factory_purchase_orders" purchase_order
    ON purchase_order."id" = settlement."purchase_order_id"
  WHERE settlement."purchase_order_id" = target_purchase_order_id;
  IF NOT FOUND THEN
    IF linked_correction_adjustment THEN
      IF snapshot_correction."settlement_final_payable_before" IS NOT NULL
        OR snapshot_correction."settlement_final_payable_after" IS NOT NULL
        OR snapshot_correction."settlement_status_before" IS NOT NULL
        OR snapshot_correction."settlement_status_after" IS NOT NULL
        OR snapshot_correction."settlement_revision_before" IS NOT NULL
        OR snapshot_correction."settlement_revision_after" IS NOT NULL
        OR snapshot_correction."settlement_increase_before" IS NOT NULL
        OR snapshot_correction."settlement_increase_after" IS NOT NULL
        OR snapshot_correction."settlement_decrease_before" IS NOT NULL
        OR snapshot_correction."settlement_decrease_after" IS NOT NULL
        OR snapshot_correction."settlement_paid_before" IS NOT NULL
        OR snapshot_correction."settlement_paid_after" IS NOT NULL
        OR snapshot_correction."settlement_settled_at_before" IS NOT NULL
        OR snapshot_correction."settlement_settled_at_after" IS NOT NULL
        OR snapshot_correction."settlement_settled_by_before" IS NOT NULL
        OR snapshot_correction."settlement_settled_by_after" IS NOT NULL THEN
        RAISE EXCEPTION 'pre-settlement price correction adjustment cannot carry settlement snapshots';
      END IF;
    END IF;
    RETURN NULL;
  END IF;
  IF linked_correction_adjustment THEN
    IF snapshot_correction."settlement_final_payable_before" IS NULL
      OR snapshot_correction."settlement_final_payable_after" IS NULL
      OR snapshot_correction."settlement_status_before" IS NULL
      OR snapshot_correction."settlement_status_after" IS NULL
      OR snapshot_correction."settlement_revision_before" IS NULL
      OR snapshot_correction."settlement_revision_after" IS NULL
      OR snapshot_correction."settlement_increase_before" IS NULL
      OR snapshot_correction."settlement_increase_after" IS NULL
      OR snapshot_correction."settlement_decrease_before" IS NULL
      OR snapshot_correction."settlement_decrease_after" IS NULL
      OR snapshot_correction."settlement_paid_before" IS NULL
      OR snapshot_correction."settlement_paid_after" IS NULL THEN
      RAISE EXCEPTION 'post-settlement price correction batch leader must commit complete audit snapshots';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'factory_purchase_order_settlements'
    AND TG_OP = 'UPDATE'
    AND (
      new_row ->> 'increase_amount' IS DISTINCT FROM old_row ->> 'increase_amount'
      OR new_row ->> 'decrease_amount' IS DISTINCT FROM old_row ->> 'decrease_amount'
      OR new_row ->> 'final_payable_amount' IS DISTINCT FROM old_row ->> 'final_payable_amount'
    ) THEN
    SELECT price_correction.*
    INTO snapshot_correction
    FROM "factory_purchase_order_price_corrections" price_correction
    WHERE price_correction."purchase_order_id" = target_purchase_order_id
      AND price_correction."settlement_revision_after" = (new_row ->> 'revision')::INTEGER;
    IF NOT FOUND
      OR snapshot_correction."status" <> 'APPROVED'
      OR snapshot_correction."settlement_revision_before" IS DISTINCT FROM (old_row ->> 'revision')::INTEGER
      OR snapshot_correction."settlement_final_payable_before" IS DISTINCT FROM (old_row ->> 'final_payable_amount')::NUMERIC
      OR snapshot_correction."settlement_final_payable_after" IS DISTINCT FROM (new_row ->> 'final_payable_amount')::NUMERIC
      OR snapshot_correction."settlement_increase_before" IS DISTINCT FROM (old_row ->> 'increase_amount')::NUMERIC
      OR snapshot_correction."settlement_increase_after" IS DISTINCT FROM (new_row ->> 'increase_amount')::NUMERIC
      OR snapshot_correction."settlement_decrease_before" IS DISTINCT FROM (old_row ->> 'decrease_amount')::NUMERIC
      OR snapshot_correction."settlement_decrease_after" IS DISTINCT FROM (new_row ->> 'decrease_amount')::NUMERIC
      OR snapshot_correction."settlement_paid_before" IS DISTINCT FROM (old_row ->> 'paid_amount_at_settlement')::NUMERIC
      OR snapshot_correction."settlement_paid_after" IS DISTINCT FROM (new_row ->> 'paid_amount_at_settlement')::NUMERIC
      OR snapshot_correction."settlement_status_before"::TEXT IS DISTINCT FROM old_row ->> 'status'
      OR snapshot_correction."settlement_status_after"::TEXT IS DISTINCT FROM new_row ->> 'status'
      OR snapshot_correction."settlement_settled_at_before" IS DISTINCT FROM (old_row ->> 'settled_at')::TIMESTAMP
      OR snapshot_correction."settlement_settled_at_after" IS DISTINCT FROM (new_row ->> 'settled_at')::TIMESTAMP
      OR snapshot_correction."settlement_settled_by_before" IS DISTINCT FROM old_row ->> 'settled_by'
      OR snapshot_correction."settlement_settled_by_after" IS DISTINCT FROM new_row ->> 'settled_by' THEN
      RAISE EXCEPTION 'settlement financial revision requires an exact immutable correction batch snapshot';
    END IF;

    SELECT
      COALESCE(SUM(price_correction."delta_amount"), 0)::NUMERIC(18,2),
      COALESCE(SUM(CASE WHEN price_correction."delta_amount" > 0
        THEN price_correction."delta_amount" ELSE 0 END), 0)::NUMERIC(18,2),
      COALESCE(SUM(CASE WHEN price_correction."delta_amount" < 0
        THEN ABS(price_correction."delta_amount") ELSE 0 END), 0)::NUMERIC(18,2)
    INTO batch_delta, batch_increase, batch_decrease
    FROM "factory_purchase_order_price_corrections" price_correction
    WHERE price_correction."purchase_order_id" = target_purchase_order_id
      AND (
        (snapshot_correction."batch_id" IS NULL AND price_correction."id" = snapshot_correction."id")
        OR (
          snapshot_correction."batch_id" IS NOT NULL
          AND price_correction."batch_id" = snapshot_correction."batch_id"
        )
      );
    IF (new_row ->> 'final_payable_amount')::NUMERIC - (old_row ->> 'final_payable_amount')::NUMERIC
        IS DISTINCT FROM batch_delta
      OR (new_row ->> 'increase_amount')::NUMERIC - (old_row ->> 'increase_amount')::NUMERIC
        IS DISTINCT FROM batch_increase
      OR (new_row ->> 'decrease_amount')::NUMERIC - (old_row ->> 'decrease_amount')::NUMERIC
        IS DISTINCT FROM batch_decrease THEN
      RAISE EXCEPTION 'settlement financial revision does not match the complete correction batch';
    END IF;
  END IF;

  IF settlement_record.purchase_order_status <> 'ACCEPTED'::"FactoryPurchaseOrderStatus" THEN
    RAISE EXCEPTION 'factory settlement requires an accepted purchase order';
  END IF;
  SELECT
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'INCREASE'
    ), 0)::NUMERIC(18,2),
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'DECREASE'
    ), 0)::NUMERIC(18,2)
  INTO expected_increase, expected_decrease
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."purchase_order_id" = target_purchase_order_id;
  expected_final := ROUND(
    settlement_record.base_amount + expected_increase - expected_decrease
      - settlement_record.delay_penalty_amount,
    2
  )::NUMERIC(18,2);
  IF expected_final < 0
    OR settlement_record.increase_amount IS DISTINCT FROM expected_increase
    OR settlement_record.decrease_amount IS DISTINCT FROM expected_decrease
    OR settlement_record.final_payable_amount IS DISTINCT FROM expected_final THEN
    RAISE EXCEPTION 'factory settlement financial totals are out of sync with adjustments';
  END IF;

  net_paid := "factory_purchase_order_net_paid"(target_purchase_order_id);
  SELECT MIN(running_paid)
  INTO minimum_running_paid
  FROM (
    SELECT SUM(CASE WHEN payment."kind" = 'REFUND'
      THEN -payment."amount" ELSE payment."amount" END) OVER (
      ORDER BY payment."paid_at", payment."sequence_no", payment."id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )::NUMERIC(18,2) AS running_paid
    FROM "factory_purchase_order_payments" payment
    WHERE payment."purchase_order_id" = target_purchase_order_id
      AND payment."status" = 'CONFIRMED'
  ) running_payment_ledger;
  IF COALESCE(minimum_running_paid, 0) < 0 THEN
    RAISE EXCEPTION 'factory purchase refund cannot precede or exceed confirmed payments by ledger date';
  END IF;
  SELECT MAX(payment."paid_at")
  INTO latest_payment_date
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = target_purchase_order_id
    AND payment."status" = 'CONFIRMED';
  expected_status := CASE
    WHEN net_paid < settlement_record.final_payable_amount
      THEN 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    WHEN net_paid = settlement_record.final_payable_amount
      THEN 'SETTLED'::"FactoryPurchaseSettlementStatus"
    ELSE 'PENDING_REFUND'::"FactoryPurchaseSettlementStatus"
  END;
  IF settlement_record.paid_amount_at_settlement IS DISTINCT FROM net_paid
    OR settlement_record.status IS DISTINCT FROM expected_status THEN
    RAISE EXCEPTION 'factory settlement status is out of sync with net confirmed payments';
  END IF;
  IF expected_status = 'SETTLED' AND (
    settlement_record.settled_at IS NULL OR settlement_record.settled_by IS NULL
  ) THEN
    RAISE EXCEPTION 'fully paid factory settlement must be closed in the same transaction';
  END IF;
  IF expected_status <> 'SETTLED' AND (
    settlement_record.settled_at IS NOT NULL OR settlement_record.settled_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'pending factory settlement must remain open';
  END IF;

  expected_payment_status := CASE
    WHEN net_paid > settlement_record.final_payable_amount THEN '待退款'
    WHEN net_paid = settlement_record.final_payable_amount THEN '已支付'
    WHEN net_paid > 0 THEN '部分支付'
    ELSE '待支付'
  END;
  expected_paid := net_paid > 0 OR net_paid = settlement_record.final_payable_amount;
  expected_payment_date := CASE
    WHEN net_paid > 0 THEN latest_payment_date
    WHEN settlement_record.final_payable_amount = 0
      THEN settlement_record.actual_delivery_date
    ELSE NULL
  END;

  SELECT cost."id", cost."amount", cost."amount_cny",
         cost."payment_status", cost."paid",
         cost."payment_date"::DATE AS payment_date,
         cost."paid_at"::DATE AS paid_at
  INTO settlement_cost
  FROM "order_costs" cost
  WHERE cost."source_type" = 'FACTORY_PURCHASE_SETTLEMENT'
    AND cost."source_id" = target_purchase_order_id
    AND cost."status" = 'ACTIVE'
    AND cost."deleted_at" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'factory settlement requires one active settlement cost';
  END IF;
  IF settlement_cost.amount IS DISTINCT FROM settlement_record.final_payable_amount
    OR settlement_cost.amount_cny IS DISTINCT FROM ROUND(
      settlement_record.final_payable_amount * settlement_record.exchange_rate, 2
    ) THEN
    RAISE EXCEPTION 'factory settlement cost amount is out of sync';
  END IF;
  IF settlement_cost.payment_status IS DISTINCT FROM expected_payment_status
    OR settlement_cost.paid IS DISTINCT FROM expected_paid
    OR settlement_cost.payment_date IS DISTINCT FROM expected_payment_date
    OR settlement_cost.paid_at IS DISTINCT FROM expected_payment_date THEN
    RAISE EXCEPTION 'factory settlement cost payment state is out of sync';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- Only the first line of a batch owns the settlement before/after snapshot.
-- Every line still owns an immutable request and a one-to-one adjustment.
CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_price_correction"()
RETURNS trigger AS $$
DECLARE
  settlement_record RECORD;
  net_paid NUMERIC(18,2);
  expected_before_status "FactoryPurchaseSettlementStatus";
  expected_after_status "FactoryPurchaseSettlementStatus";
  snapshots_complete BOOLEAN;
  snapshots_present BOOLEAN;
  adjustment_record RECORD;
  is_batch_leader BOOLEAN;
  correction_count INTEGER;
  expected_line_count INTEGER;
  adjustment_count INTEGER;
  adjustments_match BOOLEAN;
  batch_delta NUMERIC(18,2);
  batch_increase NUMERIC(18,2);
  batch_decrease NUMERIC(18,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase price correction records cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING'
      OR NEW."review_remark" IS NOT NULL
      OR NEW."adjustment_id" IS NOT NULL
      OR NEW."settlement_final_payable_before" IS NOT NULL
      OR NEW."settlement_final_payable_after" IS NOT NULL
      OR NEW."settlement_status_before" IS NOT NULL
      OR NEW."settlement_status_after" IS NOT NULL
      OR NEW."settlement_revision_before" IS NOT NULL
      OR NEW."settlement_revision_after" IS NOT NULL
      OR NEW."settlement_increase_before" IS NOT NULL
      OR NEW."settlement_increase_after" IS NOT NULL
      OR NEW."settlement_decrease_before" IS NOT NULL
      OR NEW."settlement_decrease_after" IS NOT NULL
      OR NEW."settlement_paid_before" IS NOT NULL
      OR NEW."settlement_paid_after" IS NOT NULL
      OR NEW."settlement_settled_at_before" IS NOT NULL
      OR NEW."settlement_settled_at_after" IS NOT NULL
      OR NEW."settlement_settled_by_before" IS NOT NULL
      OR NEW."settlement_settled_by_after" IS NOT NULL
      OR NEW."reviewed_by" IS NOT NULL
      OR NEW."reviewed_at" IS NOT NULL THEN
      RAISE EXCEPTION 'new factory purchase price correction must start pending and unreviewed';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'reviewed factory purchase price correction records are immutable';
  END IF;

  IF (
    TO_JSONB(NEW)
      - 'status' - 'review_remark' - 'adjustment_id'
      - 'settlement_final_payable_before' - 'settlement_final_payable_after'
      - 'settlement_status_before' - 'settlement_status_after'
      - 'settlement_revision_before' - 'settlement_revision_after'
      - 'settlement_increase_before' - 'settlement_increase_after'
      - 'settlement_decrease_before' - 'settlement_decrease_after'
      - 'settlement_paid_before' - 'settlement_paid_after'
      - 'settlement_settled_at_before' - 'settlement_settled_at_after'
      - 'settlement_settled_by_before' - 'settlement_settled_by_after'
      - 'reviewed_by' - 'reviewed_at' - 'updated_at'
  ) IS DISTINCT FROM (
    TO_JSONB(OLD)
      - 'status' - 'review_remark' - 'adjustment_id'
      - 'settlement_final_payable_before' - 'settlement_final_payable_after'
      - 'settlement_status_before' - 'settlement_status_after'
      - 'settlement_revision_before' - 'settlement_revision_after'
      - 'settlement_increase_before' - 'settlement_increase_after'
      - 'settlement_decrease_before' - 'settlement_decrease_after'
      - 'settlement_paid_before' - 'settlement_paid_after'
      - 'settlement_settled_at_before' - 'settlement_settled_at_after'
      - 'settlement_settled_by_before' - 'settlement_settled_by_after'
      - 'reviewed_by' - 'reviewed_at' - 'updated_at'
  ) THEN
    RAISE EXCEPTION 'factory purchase price correction request content is immutable after submission';
  END IF;
  IF NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION 'factory purchase price correction update must review the request';
  END IF;
  IF NEW."reviewed_by" IS NULL OR NEW."reviewed_at" IS NULL THEN
    RAISE EXCEPTION 'factory purchase price correction review requires reviewer and review time';
  END IF;

  snapshots_complete := NEW."settlement_final_payable_before" IS NOT NULL
    AND NEW."settlement_final_payable_after" IS NOT NULL
    AND NEW."settlement_status_before" IS NOT NULL
    AND NEW."settlement_status_after" IS NOT NULL
    AND NEW."settlement_revision_before" IS NOT NULL
    AND NEW."settlement_revision_after" IS NOT NULL
    AND NEW."settlement_increase_before" IS NOT NULL
    AND NEW."settlement_increase_after" IS NOT NULL
    AND NEW."settlement_decrease_before" IS NOT NULL
    AND NEW."settlement_decrease_after" IS NOT NULL
    AND NEW."settlement_paid_before" IS NOT NULL
    AND NEW."settlement_paid_after" IS NOT NULL
    AND ((NEW."settlement_status_before" = 'SETTLED'
        AND NEW."settlement_settled_at_before" IS NOT NULL
        AND NEW."settlement_settled_by_before" IS NOT NULL)
      OR (NEW."settlement_status_before" <> 'SETTLED'
        AND NEW."settlement_settled_at_before" IS NULL
        AND NEW."settlement_settled_by_before" IS NULL))
    AND ((NEW."settlement_status_after" = 'SETTLED'
        AND NEW."settlement_settled_at_after" IS NOT NULL
        AND NEW."settlement_settled_by_after" IS NOT NULL)
      OR (NEW."settlement_status_after" <> 'SETTLED'
        AND NEW."settlement_settled_at_after" IS NULL
        AND NEW."settlement_settled_by_after" IS NULL));
  snapshots_present := NEW."settlement_final_payable_before" IS NOT NULL
    OR NEW."settlement_final_payable_after" IS NOT NULL
    OR NEW."settlement_status_before" IS NOT NULL
    OR NEW."settlement_status_after" IS NOT NULL
    OR NEW."settlement_revision_before" IS NOT NULL
    OR NEW."settlement_revision_after" IS NOT NULL
    OR NEW."settlement_increase_before" IS NOT NULL
    OR NEW."settlement_increase_after" IS NOT NULL
    OR NEW."settlement_decrease_before" IS NOT NULL
    OR NEW."settlement_decrease_after" IS NOT NULL
    OR NEW."settlement_paid_before" IS NOT NULL
    OR NEW."settlement_paid_after" IS NOT NULL
    OR NEW."settlement_settled_at_before" IS NOT NULL
    OR NEW."settlement_settled_at_after" IS NOT NULL
    OR NEW."settlement_settled_by_before" IS NOT NULL
    OR NEW."settlement_settled_by_after" IS NOT NULL;

  IF NEW."status" = 'REJECTED' THEN
    IF NEW."adjustment_id" IS NOT NULL OR snapshots_present THEN
      RAISE EXCEPTION 'rejected factory purchase price correction cannot carry settlement effects';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."adjustment_id" IS NULL THEN
    RAISE EXCEPTION 'approved factory purchase price correction requires an adjustment row';
  END IF;

  SELECT adjustment."purchase_order_id", adjustment."source_type",
         adjustment."source_id", adjustment."kind", adjustment."direction",
         adjustment."amount", adjustment."currency", adjustment."status"
  INTO adjustment_record
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."id" = NEW."adjustment_id";
  IF NOT FOUND
    OR adjustment_record."purchase_order_id" IS DISTINCT FROM NEW."purchase_order_id"
    OR adjustment_record."source_type" IS DISTINCT FROM 'PURCHASE_PRICE_CORRECTION'
    OR adjustment_record."source_id" IS DISTINCT FROM NEW."id"
    OR adjustment_record."kind" <> 'OTHER'
    OR adjustment_record."status" <> 'CONFIRMED'
    OR adjustment_record."currency" IS DISTINCT FROM NEW."currency"
    OR adjustment_record."amount" IS DISTINCT FROM ABS(NEW."delta_amount")
    OR adjustment_record."direction"::TEXT IS DISTINCT FROM (
      CASE WHEN NEW."delta_amount" > 0 THEN 'INCREASE' ELSE 'DECREASE' END
    ) THEN
    RAISE EXCEPTION 'approved purchase price correction adjustment does not match its request';
  END IF;

  SELECT settlement."final_payable_amount", settlement."status",
         settlement."revision", settlement."increase_amount",
         settlement."decrease_amount", settlement."paid_amount_at_settlement",
         settlement."settled_at", settlement."settled_by"
  INTO settlement_record
  FROM "factory_purchase_order_settlements" settlement
  WHERE settlement."purchase_order_id" = NEW."purchase_order_id";
  IF NOT FOUND THEN
    IF snapshots_present THEN
      RAISE EXCEPTION 'pre-settlement price correction cannot carry settlement snapshots';
    END IF;
    RETURN NEW;
  END IF;

  is_batch_leader := NEW."batch_id" IS NULL OR NEW."batch_line_no" = 1;
  IF NOT is_batch_leader THEN
    IF snapshots_present THEN
      RAISE EXCEPTION 'only the batch leader may carry settlement snapshots';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT snapshots_complete THEN
    RAISE EXCEPTION 'post-settlement price correction batch leader requires complete snapshots';
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    MAX(COALESCE(price_correction."batch_line_count", 1))::INTEGER,
    COUNT(adjustment."id")::INTEGER,
    COALESCE(BOOL_AND(
      adjustment."id" IS NOT NULL
      AND adjustment."source_type" = 'PURCHASE_PRICE_CORRECTION'
      AND adjustment."status" = 'CONFIRMED'
      AND adjustment."purchase_order_id" = price_correction."purchase_order_id"
      AND adjustment."amount" = ABS(price_correction."delta_amount")
      AND adjustment."direction"::TEXT = CASE
        WHEN price_correction."delta_amount" > 0 THEN 'INCREASE'
        ELSE 'DECREASE'
      END
    ), FALSE),
    COALESCE(SUM(price_correction."delta_amount"), 0)::NUMERIC(18,2),
    COALESCE(SUM(CASE WHEN price_correction."delta_amount" > 0
      THEN price_correction."delta_amount" ELSE 0 END), 0)::NUMERIC(18,2),
    COALESCE(SUM(CASE WHEN price_correction."delta_amount" < 0
      THEN ABS(price_correction."delta_amount") ELSE 0 END), 0)::NUMERIC(18,2)
  INTO correction_count, expected_line_count, adjustment_count,
       adjustments_match, batch_delta, batch_increase, batch_decrease
  FROM "factory_purchase_order_price_corrections" price_correction
  LEFT JOIN "factory_purchase_order_adjustments" adjustment
    ON adjustment."source_type" = 'PURCHASE_PRICE_CORRECTION'
   AND adjustment."source_id" = price_correction."id"
   AND adjustment."purchase_order_id" = price_correction."purchase_order_id"
  WHERE price_correction."purchase_order_id" = NEW."purchase_order_id"
    AND (
      (NEW."batch_id" IS NULL AND price_correction."id" = NEW."id")
      OR (NEW."batch_id" IS NOT NULL AND price_correction."batch_id" = NEW."batch_id")
    );
  IF correction_count <> expected_line_count
    OR adjustment_count <> expected_line_count
    OR adjustments_match IS NOT TRUE THEN
    RAISE EXCEPTION 'approved purchase price correction batch requires every line adjustment';
  END IF;

  net_paid := "factory_purchase_order_net_paid"(NEW."purchase_order_id");
  expected_before_status := CASE
    WHEN net_paid < NEW."settlement_final_payable_before" THEN 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    WHEN net_paid = NEW."settlement_final_payable_before" THEN 'SETTLED'::"FactoryPurchaseSettlementStatus"
    ELSE 'PENDING_REFUND'::"FactoryPurchaseSettlementStatus"
  END;
  expected_after_status := CASE
    WHEN net_paid < NEW."settlement_final_payable_after" THEN 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    WHEN net_paid = NEW."settlement_final_payable_after" THEN 'SETTLED'::"FactoryPurchaseSettlementStatus"
    ELSE 'PENDING_REFUND'::"FactoryPurchaseSettlementStatus"
  END;

  IF NEW."settlement_final_payable_after" IS DISTINCT FROM settlement_record."final_payable_amount"
    OR NEW."settlement_status_after" IS DISTINCT FROM settlement_record."status"
    OR NEW."settlement_revision_after" IS DISTINCT FROM settlement_record."revision"
    OR NEW."settlement_revision_after" IS DISTINCT FROM NEW."settlement_revision_before" + 1
    OR NEW."settlement_increase_after" IS DISTINCT FROM settlement_record."increase_amount"
    OR NEW."settlement_decrease_after" IS DISTINCT FROM settlement_record."decrease_amount"
    OR NEW."settlement_paid_before" IS DISTINCT FROM net_paid
    OR NEW."settlement_paid_after" IS DISTINCT FROM net_paid
    OR NEW."settlement_settled_at_after" IS DISTINCT FROM settlement_record."settled_at"
    OR NEW."settlement_settled_by_after" IS DISTINCT FROM settlement_record."settled_by"
    OR NEW."settlement_status_before" IS DISTINCT FROM expected_before_status
    OR NEW."settlement_status_after" IS DISTINCT FROM expected_after_status
    OR NEW."settlement_final_payable_after" - NEW."settlement_final_payable_before"
      IS DISTINCT FROM batch_delta
    OR NEW."settlement_increase_after" - NEW."settlement_increase_before"
      IS DISTINCT FROM batch_increase
    OR NEW."settlement_decrease_after" - NEW."settlement_decrease_before"
      IS DISTINCT FROM batch_decrease THEN
    RAISE EXCEPTION 'purchase price correction batch snapshots do not match the revised ledger';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- A batch may contain both increases and decreases (including a net-zero
-- change).  All linked line adjustments must belong to exactly one pending
-- batch and the settlement advances only one revision for the whole batch.
CREATE OR REPLACE FUNCTION "protect_factory_purchase_order_settlement"()
RETURNS trigger AS $$
DECLARE
  net_paid NUMERIC(18,2);
  expected_increase NUMERIC(18,2);
  expected_decrease NUMERIC(18,2);
  expected_final NUMERIC(18,2);
  expected_status "FactoryPurchaseSettlementStatus";
  financial_changed BOOLEAN;
  pending_batch_count INTEGER;
  pending_adjustment_count INTEGER;
  expected_batch_line_count INTEGER;
  batch_increase NUMERIC(18,2);
  batch_decrease NUMERIC(18,2);
  batch_adjustments_match BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'factory purchase settlements cannot be deleted';
  END IF;

  IF NEW."purchase_order_id" IS DISTINCT FROM OLD."purchase_order_id"
    OR NEW."base_amount" IS DISTINCT FROM OLD."base_amount"
    OR NEW."delay_days" IS DISTINCT FROM OLD."delay_days"
    OR NEW."delay_penalty_amount" IS DISTINCT FROM OLD."delay_penalty_amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."exchange_rate" IS DISTINCT FROM OLD."exchange_rate"
    OR NEW."exchange_rate_date" IS DISTINCT FROM OLD."exchange_rate_date"
    OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'factory purchase settlement financial snapshot is immutable';
  END IF;
  IF OLD."status" = 'SETTLED' AND NEW."status" = 'SETTLED' AND (
    NEW."settled_at" IS DISTINCT FROM OLD."settled_at"
    OR NEW."settled_by" IS DISTINCT FROM OLD."settled_by"
  ) THEN
    RAISE EXCEPTION 'closed factory settlement audit fields are immutable';
  END IF;

  PERFORM purchase_order."id"
  FROM "factory_purchase_orders" purchase_order
  WHERE purchase_order."id" = NEW."purchase_order_id"
  FOR UPDATE;
  PERFORM payment."id"
  FROM "factory_purchase_order_payments" payment
  WHERE payment."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY payment."sequence_no", payment."id"
  FOR UPDATE;
  PERFORM adjustment."id"
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."purchase_order_id" = NEW."purchase_order_id"
  ORDER BY adjustment."sequence_no", adjustment."id"
  FOR UPDATE;

  SELECT
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'INCREASE'
    ), 0)::NUMERIC(18,2),
    COALESCE(SUM(adjustment."amount") FILTER (
      WHERE adjustment."status" = 'CONFIRMED'
        AND adjustment."kind" <> 'DELAY_PENALTY'
        AND adjustment."direction" = 'DECREASE'
    ), 0)::NUMERIC(18,2)
  INTO expected_increase, expected_decrease
  FROM "factory_purchase_order_adjustments" adjustment
  WHERE adjustment."purchase_order_id" = NEW."purchase_order_id";

  expected_final := ROUND(
    NEW."base_amount" + expected_increase - expected_decrease - NEW."delay_penalty_amount",
    2
  )::NUMERIC(18,2);
  IF expected_final < 0
    OR NEW."increase_amount" IS DISTINCT FROM expected_increase
    OR NEW."decrease_amount" IS DISTINCT FROM expected_decrease
    OR NEW."final_payable_amount" IS DISTINCT FROM expected_final THEN
    RAISE EXCEPTION 'factory settlement revision does not match the confirmed adjustment ledger';
  END IF;

  financial_changed := NEW."increase_amount" IS DISTINCT FROM OLD."increase_amount"
    OR NEW."decrease_amount" IS DISTINCT FROM OLD."decrease_amount"
    OR NEW."final_payable_amount" IS DISTINCT FROM OLD."final_payable_amount";

  IF financial_changed THEN
    IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
      RAISE EXCEPTION 'factory settlement price correction must advance revision exactly once';
    END IF;

    SELECT
      COUNT(DISTINCT COALESCE(price_correction."batch_id", price_correction."id"))::INTEGER,
      COUNT(*)::INTEGER,
      MAX(COALESCE(price_correction."batch_line_count", 1))::INTEGER,
      COALESCE(SUM(CASE
        WHEN price_correction."delta_amount" > 0 THEN price_correction."delta_amount"
        ELSE 0
      END), 0)::NUMERIC(18,2),
      COALESCE(SUM(CASE
        WHEN price_correction."delta_amount" < 0 THEN ABS(price_correction."delta_amount")
        ELSE 0
      END), 0)::NUMERIC(18,2),
      COALESCE(BOOL_AND(
        adjustment."amount" = ABS(price_correction."delta_amount")
        AND adjustment."direction"::TEXT = CASE
          WHEN price_correction."delta_amount" > 0 THEN 'INCREASE'
          ELSE 'DECREASE'
        END
      ), FALSE)
    INTO pending_batch_count, pending_adjustment_count,
         expected_batch_line_count, batch_increase, batch_decrease,
         batch_adjustments_match
    FROM "factory_purchase_order_adjustments" adjustment
    JOIN "factory_purchase_order_price_corrections" price_correction
      ON price_correction."id" = adjustment."source_id"
     AND price_correction."purchase_order_id" = adjustment."purchase_order_id"
    WHERE adjustment."purchase_order_id" = NEW."purchase_order_id"
      AND adjustment."source_type" = 'PURCHASE_PRICE_CORRECTION'
      AND adjustment."status" = 'CONFIRMED'
      AND price_correction."status" = 'PENDING';

    IF pending_batch_count <> 1
      OR pending_adjustment_count <> expected_batch_line_count
      OR batch_adjustments_match IS NOT TRUE
      OR NEW."increase_amount" - OLD."increase_amount" IS DISTINCT FROM batch_increase
      OR NEW."decrease_amount" - OLD."decrease_amount" IS DISTINCT FROM batch_decrease
      OR NEW."final_payable_amount" - OLD."final_payable_amount"
        IS DISTINCT FROM batch_increase - batch_decrease THEN
      RAISE EXCEPTION 'settlement financial revision requires one complete purchase price correction batch';
    END IF;
  ELSIF NEW."revision" IS DISTINCT FROM OLD."revision" THEN
    RAISE EXCEPTION 'factory settlement revision may only change with a price correction';
  END IF;

  net_paid := "factory_purchase_order_net_paid"(NEW."purchase_order_id");
  expected_status := CASE
    WHEN net_paid < NEW."final_payable_amount" THEN 'PENDING_PAYMENT'::"FactoryPurchaseSettlementStatus"
    WHEN net_paid = NEW."final_payable_amount" THEN 'SETTLED'::"FactoryPurchaseSettlementStatus"
    ELSE 'PENDING_REFUND'::"FactoryPurchaseSettlementStatus"
  END;
  IF NEW."paid_amount_at_settlement" IS DISTINCT FROM net_paid
    OR NEW."status" IS DISTINCT FROM expected_status THEN
    RAISE EXCEPTION 'factory settlement status must follow net confirmed payments';
  END IF;
  IF expected_status = 'SETTLED' AND (
    NEW."settled_at" IS NULL OR NEW."settled_by" IS NULL
  ) THEN
    RAISE EXCEPTION 'fully paid factory settlement requires settlement audit fields';
  END IF;
  IF expected_status <> 'SETTLED' AND (
    NEW."settled_at" IS NOT NULL OR NEW."settled_by" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'pending payment or refund settlement cannot remain closed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "factory_purchase_price_corrections_commit_consistency"
  ON "factory_purchase_order_price_corrections";
CREATE CONSTRAINT TRIGGER "factory_purchase_price_corrections_commit_consistency"
  AFTER INSERT OR UPDATE OR DELETE ON "factory_purchase_order_price_corrections"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_factory_purchase_settlement_commit_consistency"();

COMMIT;
