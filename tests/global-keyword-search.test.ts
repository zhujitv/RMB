import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modules = {
  orders: readFileSync("app/modules/OrdersModule.tsx", "utf8"),
  payments: readFileSync("app/modules/PaymentsModule.tsx", "utf8"),
  costs: readFileSync("app/modules/CostsModule.tsx", "utf8"),
  logistics: readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8"),
  taxRefund: readFileSync("app/modules/TaxRefundModule.tsx", "utf8"),
  profit: readFileSync("app/modules/ProfitModule.tsx", "utf8"),
  overview: readFileSync("app/modules/DashboardModule.tsx", "utf8"),
};

const services = {
  orders: readFileSync("lib/platform/orders-module.ts", "utf8"),
  payments: readFileSync("lib/platform/payments-module.ts", "utf8"),
  costs: readFileSync("lib/platform/cost-records-queries.ts", "utf8"),
  logistics: readFileSync("lib/platform/domestic-logistics-api.ts", "utf8"),
  taxRefund: readFileSync("lib/platform/tax-refunds.ts", "utf8"),
  profit: readFileSync("lib/platform/profit-overview.ts", "utf8"),
};

test("business list pages use keyword for fuzzy search requests", () => {
  for (const [name, source] of Object.entries(modules)) {
    assert.match(source, /params\.set\("keyword",/, `${name} should send keyword query param`);
    assert.match(source, /onKeyDown=\{\(event\) => \{[\s\S]*?if \(event\.key === "Enter"\) submitSearch\(\);/, `${name} should submit on Enter`);
    assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*}, 300\)/, `${name} should debounce keyword search by 300ms`);
  }
});

test("business list APIs read keyword and use contains fuzzy matching", () => {
  assert.match(services.orders, /const keyword = nonEmpty\(query\?\.get\("keyword"\)\)/);
  assert.match(services.payments, /const keyword = nonEmpty\(query\?\.get\("keyword"\)\)/);
  assert.match(services.costs, /const keyword = insensitiveContains\(query\.get\("keyword"\)\)/);
  assert.match(services.logistics, /const keyword = nonEmpty\(query\.get\("keyword"\)\)/);
  assert.match(services.taxRefund, /const keyword = nonEmpty\(query\.get\("keyword"\)\)/);
  assert.match(services.profit, /const keyword = nonEmpty\(query\.get\("keyword"\)\)/);

  for (const [name, source] of Object.entries(services)) {
    assert.match(source, /contains:/, `${name} should use Prisma contains keyword search`);
    assert.match(source, /mode: "insensitive"/, `${name} should use case-insensitive search`);
  }
});

test("keyword search covers the required business fields", () => {
  assert.match(services.orders, /orderNo: \{ contains: keyword/);
  assert.match(services.orders, /blNo: \{ contains: keyword/);
  assert.match(services.orders, /salesperson: \{ is: \{ name: \{ contains: keyword/);

  assert.match(services.payments, /bankReference: \{ contains: keyword/);
  assert.match(services.payments, /remark: \{ contains: keyword/);
  assert.match(services.payments, /paymentType: \{ contains: keyword/);

  assert.match(services.costs, /costType: keyword/);
  assert.match(services.costs, /remark: keyword/);
  assert.match(services.costs, /supplierNameSnapshot: keyword/);

	  assert.match(services.logistics, /containerNo: \{ contains: keyword/);
	  assert.match(services.logistics, /containerType: \{ contains: keyword/);
	  assert.match(services.logistics, /sealNo: \{ contains: keyword/);
	  assert.match(services.logistics, /logisticsSuppliers: \{ some: \{ supplier: \{ is: \{ supplierName: \{ contains: keyword/);

  assert.match(services.taxRefund, /customsDeclarationNo: \{ contains: keyword/);
  assert.match(services.taxRefund, /blNo: \{ contains: keyword/);
  assert.match(services.taxRefund, /logisticsBills: \{ some: \{ deletedAt: null, billOfLadingNo: \{ contains: keyword/);

  assert.match(services.profit, /salesperson: \{ is: \{ name: \{ contains: keyword/);
});
