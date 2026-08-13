import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20260813113000_heterogeneous_trigger_record_safety/migration.sql",
  "utf8",
);

function migrationFunction(name: string) {
  return migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION "${name}"\\(\\) RETURNS trigger AS \\$\\$[\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`),
  )?.[0] || "";
}

test("heterogeneous trigger correction is forward-only and bounded", () => {
  assert.match(migration, /^-- Forward-only correction:/);
  assert.match(migration, /BEGIN;[\s\S]*SET LOCAL lock_timeout = '5s';/);
  assert.match(migration, /SET LOCAL statement_timeout = '2min';/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.doesNotMatch(migration, /(?:ALTER|DROP|TRUNCATE|DELETE|UPDATE|INSERT)\s+(?:TABLE|FROM|INTO)?\s*"/i);
});

test("shared trigger functions never address heterogeneous OLD or NEW fields directly", () => {
  const functions = [
    migrationFunction("guard_factory_purchase_financial_dates"),
    migrationFunction("assert_sales_quotation_decision_commit_consistency"),
    migrationFunction("assert_factory_purchase_settlement_commit_consistency"),
  ];

  for (const body of functions) {
    assert.notEqual(body, "");
    assert.match(body, /to_jsonb\((?:OLD|NEW)\)/);
    assert.doesNotMatch(body, /\b(?:OLD|NEW)\."[a-z_]+"/i);
  }
});

test("financial date guards retain both Shanghai-date invariants", () => {
  const body = migrationFunction("guard_factory_purchase_financial_dates");

  assert.match(body, /TG_TABLE_NAME = 'factory_purchase_order_payments'/);
  assert.match(body, /new_row ->> 'paid_at'/);
  assert.match(body, /factory purchase payment date cannot be in the future/);
  assert.match(body, /TG_TABLE_NAME = 'factory_purchase_order_settlements'/);
  assert.match(body, /new_row ->> 'exchange_rate_date'/);
  assert.match(body, /factory settlement exchange-rate date cannot be in the future/);
  assert.match(body, /AT TIME ZONE 'Asia\/Shanghai'/);
});

test("quotation decision consistency still enforces current-version status matching", () => {
  const body = migrationFunction("assert_sales_quotation_decision_commit_consistency");

  assert.match(body, /TG_TABLE_NAME = 'sales_quotations'/);
  assert.match(body, /TG_TABLE_NAME = 'sales_quotation_decisions'/);
  assert.match(body, /old_row ->> 'quotation_id'/);
  assert.match(body, /new_row ->> 'quotation_id'/);
  assert.match(body, /quotation accepted or rejected status requires a matching current-version decision/);
  assert.match(body, /draft or sent quotation cannot have a current-version decision/);
});

test("ordinary order costs return without losing factory settlement invariants", () => {
  const body = migrationFunction("assert_factory_purchase_settlement_commit_consistency");

  assert.match(body, /TG_TABLE_NAME = 'order_costs'/);
  assert.match(body, /new_row ->> 'source_type' = 'FACTORY_PURCHASE_SETTLEMENT'/);
  assert.match(body, /old_row ->> 'source_type' = 'FACTORY_PURCHASE_SETTLEMENT'/);
  assert.match(body, /ELSE NULL[\s\S]*IF target_purchase_order_id IS NULL THEN RETURN NULL; END IF;/);
  assert.match(body, /factory settlement requires an accepted purchase order/);
  assert.match(body, /factory settlement payments exceed final payable amount/);
  assert.match(body, /factory settlement requires one active settlement cost/);
  assert.match(body, /factory settlement cost payment state is out of sync/);
});
