import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  assertDomesticShipmentDateNotFuture,
  domesticShipmentDateFromItems,
  shouldSyncDomesticShipmentDate,
} = jiti("../lib/platform/domestic-logistics-shipment-sync.ts") as typeof import("../lib/platform/domestic-logistics-shipment-sync.ts");
const { orderStatusAfterShipment } = jiti(
  "../lib/platform/shared-order-calculations.ts",
) as typeof import("../lib/platform/shared-order-calculations.ts");

const mutationsSource = readFileSync(
  new URL("../lib/platform/domestic-logistics-mutations.ts", import.meta.url),
  "utf8",
);
const orderSyncSource = readFileSync(
  new URL("../lib/platform/domestic-logistics-order-sync.ts", import.meta.url),
  "utf8",
);
const deleteSource = readFileSync(
  new URL("../lib/platform/domestic-logistics-delete.ts", import.meta.url),
  "utf8",
);
const shipmentImplementationSource = `${mutationsSource}\n${orderSyncSource}`;
const migrationSource = readFileSync(
  new URL("../prisma/migrations/20260814170000_tax_archive_marks_order_shipped/migration.sql", import.meta.url),
  "utf8",
);

function isoDay(value: Date | string | null) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

test("truck and multimodal logistics choose the earliest departure date regardless of row order", () => {
  const unorderedItems = [
    { departureDate: new Date("2026-08-12T00:00:00.000Z") },
    { departureDate: new Date("2026-08-08T00:00:00.000Z") },
    { departureDate: new Date("2026-08-10T00:00:00.000Z") },
  ];

  assert.equal(isoDay(domesticShipmentDateFromItems("TRUCK", unorderedItems)), "2026-08-08");
  assert.equal(isoDay(domesticShipmentDateFromItems("MULTIMODAL", [...unorderedItems].reverse())), "2026-08-08");
});

test("bulk warehouse and express dates never become an order shipment date", () => {
  const items = [{ departureDate: new Date("2026-08-08T00:00:00.000Z") }];

  assert.equal(domesticShipmentDateFromItems("BULK_WAREHOUSE", items), null);
  assert.equal(domesticShipmentDateFromItems("EXPRESS", items), null);
});

test("automatic logistics sync fills an empty date and follows its own prior value without overwriting a manual date", () => {
  const previousAutoDate = new Date("2026-08-08T00:00:00.000Z");

  assert.equal(shouldSyncDomesticShipmentDate(null, previousAutoDate), true);
  assert.equal(
    shouldSyncDomesticShipmentDate(new Date("2026-08-08T00:00:00.000Z"), previousAutoDate),
    true,
  );
  assert.equal(
    shouldSyncDomesticShipmentDate(new Date("2026-08-09T00:00:00.000Z"), previousAutoDate),
    false,
  );
  assert.equal(shouldSyncDomesticShipmentDate(new Date("2026-08-09T00:00:00.000Z"), null), false);
});

test("a future domestic departure cannot become an actual shipment date", () => {
  assert.throws(
    () => assertDomesticShipmentDateNotFuture("2026-08-15", "2026-08-14"),
    (error: unknown) => (error as { code?: string }).code === "DOMESTIC_DEPARTURE_DATE_FUTURE",
  );
  assert.doesNotThrow(() => assertDomesticShipmentDateNotFuture("2026-08-14", "2026-08-14"));
});

test("domestic departure sync advances early order states and preserves collection or terminal states", () => {
  for (const status of ["", "草稿", "已确认", "生产中"]) {
    assert.equal(orderStatusAfterShipment(status), "已发货", status);
  }
  for (const status of ["已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"]) {
    assert.equal(orderStatusAfterShipment(status), status, status);
  }

  assert.match(mutationsSource, /domesticShipmentDateFromItems\(transportType,\s*transportItems\)/);
  assert.match(shipmentImplementationSource, /shouldSyncDomesticShipmentDate\(/);
  assert.match(shipmentImplementationSource, /orderStatusAfterShipment\(/);
});

test("domestic shipment date is synchronized under the order lock in the save transaction", () => {
  const transactionStart = mutationsSource.indexOf("prisma.$transaction");
  const lockIndex = mutationsSource.indexOf("lockBusinessOrderForUpdate", transactionStart);
  const shipmentSyncIndex = mutationsSource.indexOf("syncOrderFromDomesticDeparture", lockIndex);

  assert.ok(transactionStart >= 0, "save must use a transaction");
  assert.ok(lockIndex > transactionStart, "the order must be locked inside the transaction");
  assert.ok(shipmentSyncIndex > lockIndex, "the shipment date must be synchronized only after the lock");
  assert.match(orderSyncSource, /assertBusinessNotArchived\(/);
  assert.match(orderSyncSource, /assertCommissionNotSettled\(/);
  assert.match(orderSyncSource, /writeAudit\([\s\S]*?"receivable_orders"[\s\S]*?,\s*tx\s*\)/);
});

test("deletion shares the parent-order lock and transaction with save", () => {
  assert.match(deleteSource, /prisma\.\$transaction/);
  assert.match(deleteSource, /lockBusinessOrderForUpdate\(tx, candidate\.orderId\)/);
  assert.match(deleteSource, /where: \{ id, orderId: candidate\.orderId, deletedAt: null \}/);
  assert.match(deleteSource, /writeAudit\([\s\S]*?,\s*tx\s*\)/);
});

test("historical domestic departure backfill is conservative and uses the real transport-item table", () => {
  const latestRecordSelection = migrationSource.search(
    /DISTINCT\s+ON\s*\(\s*info\."order_id"\s*\)/i,
  );
  const latestRecordOrdering = migrationSource.search(
    /ORDER\s+BY\s+info\."order_id"\s*,\s*info\."updated_at"\s+DESC\s*,\s*info\."created_at"\s+DESC/i,
  );
  const supportedTypeFilter = migrationSource.search(
    /"transport_type"\s+IN\s*\(\s*'TRUCK'\s*,\s*'MULTIMODAL'\s*\)/i,
  );

  assert.ok(latestRecordSelection >= 0, "each order must first select its latest active logistics record");
  assert.ok(latestRecordOrdering > latestRecordSelection, "latest logistics selection must be ordered by updated and created time");
  assert.ok(supportedTypeFilter > latestRecordOrdering, "transport type filtering must happen after selecting the latest record");
  assert.match(migrationSource, /"logistics_transport_items"/);
  assert.doesNotMatch(migrationSource, /"domestic_logistics_transport_items"/);
  assert.match(migrationSource, /"transport_type"\s+IN\s*\(\s*'TRUCK'\s*,\s*'MULTIMODAL'\s*\)/i);
  assert.match(migrationSource, /MIN\s*\([^)]*"departure_date"[^)]*\)/i);
  assert.match(migrationSource, /"domestic_logistics_infos"/);
  assert.match(migrationSource, /"deleted_at"\s+IS\s+NULL/i);
  assert.match(migrationSource, /"actual_shipment_date"\s+IS\s+NULL/i);
  assert.match(migrationSource, /"departure_date"\s*<=\s*CURRENT_DATE/i);
  assert.match(migrationSource, /CASE\s+WHEN\s+COUNT\s*\(\s*item\."id"\s*\)\s*>\s*0/i,
    "the legacy header date may be used only when the latest record has no detail rows");
  assert.match(migrationSource, /ELSE\s+MIN\s*\(\s*info\."departure_date"\s*\)/i);
  assert.match(migrationSource, /"status"\s+NOT\s+IN\s*\(\s*'已发货'\s*,\s*'部分收款'\s*,\s*'已收齐'\s*,\s*'多收款'\s*,\s*'已关闭'\s*,\s*'已取消'\s*\)/i);
});
