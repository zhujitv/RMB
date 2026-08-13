import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const runPostgresRegression = process.env.RMB_POSTGRES_TRIGGER_REGRESSION === "1";
const databaseUrl = process.env.DATABASE_URL;
const migration = readFileSync(
  "prisma/migrations/20260813113000_heterogeneous_trigger_record_safety/migration.sql",
  "utf8",
);
const require = createRequire(import.meta.url);

function migrationFunction(name: string) {
  const body = migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION "${name}"\\(\\) RETURNS trigger AS \\$\\$[\\s\\S]*?\\$\\$ LANGUAGE plpgsql;`),
  )?.[0];
  assert.ok(body, `missing migration function ${name}`);
  return body;
}

test(
  "PostgreSQL permits an ordinary order cost and still rejects an inconsistent factory cost",
  { skip: !runPostgresRegression || !databaseUrl },
  async () => {
    const { Client } = require("pg") as {
      Client: new (options: { connectionString: string }) => {
        connect(): Promise<void>;
        query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
        end(): Promise<void>;
      };
    };
    const client = new Client({ connectionString: databaseUrl! });
    let transactionOpen = false;

    await client.connect();
    try {
      const originalFunctions = await client.query(`
        SELECT "proname", pg_get_functiondef(pg_proc."oid") AS "definition"
        FROM pg_proc
        JOIN pg_namespace ON pg_namespace."oid" = pg_proc."pronamespace"
        WHERE pg_namespace."nspname" = 'public'
          AND pg_proc."proname" = ANY (ARRAY[
            'guard_factory_purchase_financial_dates',
            'assert_sales_quotation_decision_commit_consistency',
            'assert_factory_purchase_settlement_commit_consistency'
          ])
        ORDER BY "proname"
      `);
      await client.query("BEGIN");
      transactionOpen = true;
      for (const name of [
        "guard_factory_purchase_financial_dates",
        "assert_sales_quotation_decision_commit_consistency",
        "assert_factory_purchase_settlement_commit_consistency",
      ]) {
        await client.query(migrationFunction(name));
      }

      await client.query(`
        CREATE TEMP TABLE "factory_purchase_orders" (
          "id" TEXT PRIMARY KEY,
          "status" public."FactoryPurchaseOrderStatus" NOT NULL,
          "actual_delivery_date" DATE
        );
        CREATE TEMP TABLE "factory_purchase_order_settlements" (
          "purchase_order_id" TEXT PRIMARY KEY,
          "status" public."FactoryPurchaseSettlementStatus" NOT NULL,
          "final_payable_amount" NUMERIC(18,2) NOT NULL,
          "paid_amount_at_settlement" NUMERIC(18,2) NOT NULL,
          "settled_at" TIMESTAMP,
          "settled_by" TEXT
        );
        CREATE TEMP TABLE "factory_purchase_order_payments" (
          "purchase_order_id" TEXT NOT NULL,
          "amount" NUMERIC(18,2) NOT NULL,
          "paid_at" DATE NOT NULL,
          "status" TEXT NOT NULL
        );
        CREATE TEMP TABLE "order_costs" (
          "id" TEXT PRIMARY KEY,
          "source_type" TEXT NOT NULL,
          "source_id" TEXT,
          "status" TEXT NOT NULL DEFAULT 'ACTIVE',
          "deleted_at" TIMESTAMP,
          "payment_status" TEXT NOT NULL DEFAULT '待支付',
          "paid" BOOLEAN NOT NULL DEFAULT FALSE,
          "payment_date" DATE,
          "paid_at" TIMESTAMP
        );
        CREATE CONSTRAINT TRIGGER "regression_factory_purchase_costs_commit_consistency"
          AFTER INSERT OR UPDATE OR DELETE ON "order_costs"
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW
          EXECUTE FUNCTION public."assert_factory_purchase_settlement_commit_consistency"();
      `);

      await client.query(`
        INSERT INTO "order_costs" ("id", "source_type", "source_id")
        VALUES ('ordinary-cost', 'LOGISTICS_EXPENSE', 'ordinary-expense');
        SET CONSTRAINTS "regression_factory_purchase_costs_commit_consistency" IMMEDIATE;
      `);
      const ordinary = await client.query(
        `SELECT COUNT(*)::int AS "count" FROM "order_costs" WHERE "id" = 'ordinary-cost'`,
      );
      assert.equal(ordinary.rows[0]?.count, 1);

      await client.query(`
        SET CONSTRAINTS "regression_factory_purchase_costs_commit_consistency" DEFERRED;
        SAVEPOINT factory_invariant;
        INSERT INTO "factory_purchase_orders" ("id", "status")
        VALUES ('factory-po', 'ACCEPTED');
        INSERT INTO "factory_purchase_order_settlements" (
          "purchase_order_id", "status", "final_payable_amount", "paid_amount_at_settlement"
        ) VALUES ('factory-po', 'PENDING_PAYMENT', 10, 0);
        INSERT INTO "order_costs" (
          "id", "source_type", "source_id", "payment_status", "paid"
        ) VALUES (
          'factory-cost', 'FACTORY_PURCHASE_SETTLEMENT', 'factory-po', '已支付', FALSE
        );
      `);

      await assert.rejects(
        client.query(`SET CONSTRAINTS "regression_factory_purchase_costs_commit_consistency" IMMEDIATE`),
        (error: unknown) => {
          const databaseError = error as { message?: string };
          return databaseError.message?.includes("factory settlement cost payment state is out of sync") === true;
        },
      );
      await client.query("ROLLBACK TO SAVEPOINT factory_invariant");

      await client.query("ROLLBACK");
      transactionOpen = false;
      const restoredFunctions = await client.query(`
        SELECT "proname", pg_get_functiondef(pg_proc."oid") AS "definition"
        FROM pg_proc
        JOIN pg_namespace ON pg_namespace."oid" = pg_proc."pronamespace"
        WHERE pg_namespace."nspname" = 'public'
          AND pg_proc."proname" = ANY (ARRAY[
            'guard_factory_purchase_financial_dates',
            'assert_sales_quotation_decision_commit_consistency',
            'assert_factory_purchase_settlement_commit_consistency'
          ])
        ORDER BY "proname"
      `);
      assert.deepEqual(restoredFunctions.rows, originalFunctions.rows);
      const temporaryRelation = await client.query(
        `SELECT to_regclass('pg_temp.order_costs') AS "relation"`,
      );
      assert.equal(temporaryRelation.rows[0]?.relation, null);
    } finally {
      if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  },
);
