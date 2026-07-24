import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readCostRecordsQueriesSource,
  readCostsModuleSource,
  readDashboardModuleSource,
  readDomesticLogisticsApiSource,
  readDomesticLogisticsModuleSource,
  readOrdersModuleSource,
  readOrdersServiceSource,
  readPaymentsModuleSource,
  readPaymentsServiceSource,
  readProfitModuleSource,
  readTaxRefundModuleSource,
  readTaxRefundsSource,
} from "./source-helpers.ts";

const modules = {
  orders: readOrdersModuleSource(),
  payments: readPaymentsModuleSource(),
  costs: readCostsModuleSource(),
  logistics: readDomesticLogisticsModuleSource(),
  taxRefund: readTaxRefundModuleSource(),
  profit: readProfitModuleSource(),
  overview: readDashboardModuleSource(),
};

const services = {
  orders: readOrdersServiceSource(),
  payments: readPaymentsServiceSource(),
  costs: readCostRecordsQueriesSource(),
  logistics: readDomesticLogisticsApiSource(),
  taxRefund: readTaxRefundsSource(),
  profit: readFileSync("lib/platform/profit-overview.ts", "utf8"),
};

test("business list pages use keyword for fuzzy search requests", () => {
  for (const [name, source] of Object.entries(modules)) {
    assert.match(source, /params\.set\("keyword",/, `${name} should send keyword query param`);
    const enterSubmitPattern = name === "costs"
      ? /onKeyDown=\{\(event\) => \{[\s\S]*?if \(event\.key === "Enter"\) onSubmit\(\);/
      : name === "taxRefund"
      ? /onKeyDown=\{\(event\) => \{[\s\S]*?if \(event\.key === "Enter"\) onSubmitSearch\(\);/
      : /onKeyDown=\{\(event\) => \{[\s\S]*?if \(event\.key === "Enter"\) (?:submitSearch|onSubmitSearch|actions\.onSubmitSearch|props\.onSubmitSearch|onSubmit)\(\);/;
    assert.match(source, enterSubmitPattern, `${name} should submit on Enter`);
    assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*}, 300\)/, `${name} should debounce keyword search by 300ms`);
  }
});

test("business list APIs read keyword and use contains fuzzy matching", () => {
  assert.match(services.orders, /const keyword = nonEmpty\(query\?\.get\("keyword"\)\)/);
  assert.match(
    services.payments,
    /(?:const keyword = nonEmpty\(query\?\.get\("keyword"\)\)|keyword: nonEmpty\(query\.get\("keyword"\)\))/,
  );
  assert.match(services.costs, /const keyword = insensitiveContains\(query\.get\("keyword"\)\)/);
  assert.match(services.logistics, /const keyword = nonEmpty\(query\.get\("keyword"\)\)/);
  assert.match(services.taxRefund, /const keyword = nonEmpty\(query\.get\("keyword"\)\)/);
  assert.match(services.profit, /const keyword = nonEmpty\(query\.get\("keyword"\)\)/);

  for (const [name, source] of Object.entries(services)) {
    if (name === "logistics") continue;
    assert.match(source, /contains:/, `${name} should use Prisma contains keyword search`);
    assert.match(source, /mode: "insensitive"/, `${name} should use case-insensitive search`);
  }
  assert.match(services.logistics, /ILIKE \$\{keyword\}/, "logistics should use SQL ILIKE keyword search");
});

test("keyword search covers the required business fields", () => {
  assert.match(services.orders, /orderNo: \{ contains: keyword/);
  assert.match(services.orders, /blNo: \{ contains: keyword/);
  assert.match(services.orders, /salesperson: \{ is: \{ name: \{ contains: keyword/);

  assert.match(services.payments, /bankReference: \{ contains: (?:keyword|filters\.keyword)/);
  assert.match(services.payments, /remark: \{ contains: (?:keyword|filters\.keyword)/);
  assert.match(services.payments, /paymentType: \{ contains: (?:keyword|filters\.keyword)/);

  assert.match(services.costs, /costType: keyword/);
  assert.match(services.costs, /remark: keyword/);
  assert.match(services.costs, /supplierNameSnapshot: keyword/);

  assert.match(services.logistics, /ro\.order_no ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /ro\.bl_no ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /c\.name ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /c\.short_name ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /s_keyword\.supplier_name ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /s_keyword\.supplier_type ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /dli_keyword\.remark_text ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /dti_keyword\.container_no ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /dti_keyword\.container_type ILIKE \$\{keyword\}/);
  assert.match(services.logistics, /dti_keyword\.seal_no ILIKE \$\{keyword\}/);

  assert.match(services.taxRefund, /customsDeclarationNo: \{ contains: keyword/);
  assert.match(services.taxRefund, /blNo: \{ contains: keyword/);
  assert.match(services.taxRefund, /logisticsBills: \{ some: \{ deletedAt: null, status: \{ not: "voided" \}, billOfLadingNo: \{ contains: keyword/);

  assert.match(services.profit, /salesperson: \{ is: \{ name: \{ contains: keyword/);
});
