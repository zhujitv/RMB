import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const domesticApi = readFileSync("lib/platform/domestic-logistics-api.ts", "utf8");
const domesticModule = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const domesticView = readFileSync("app/modules/domestic-logistics/module-view.tsx", "utf8");

const guardedListControllers = [
  "app/modules/OrdersModule.tsx",
  "app/modules/PaymentsModule.tsx",
  "app/modules/ProfitModule.tsx",
  "app/modules/CustomerCommunicationModule.tsx",
  "app/modules/DomesticLogisticsModule.tsx",
  "app/modules/tax-refund/use-tax-refund-controller.ts",
  "app/modules/logistics-fees/use-logistics-fees-list-controller.ts",
];

test("domestic logistics list is paginated by the API instead of slicing a loaded table", () => {
  assert.match(domesticApi, /pageParams\(query, 20, DOMESTIC_LOGISTICS_LIST_PAGE_SIZE_MAX\)/);
  assert.match(domesticApi, /findDomesticLogisticsPageOrderIds/);
  assert.match(domesticApi, /prisma\.\$queryRaw/);
  assert.match(domesticApi, /ORDER BY[\s\S]*GREATEST\(/);
  assert.doesNotMatch(domesticApi, /DOMESTIC_LOGISTICS_LIST_SCAN_LIMIT/);
  assert.doesNotMatch(domesticApi, /findDomesticLogisticsOrderSortCandidates/);
  assert.match(domesticApi, /LIMIT \$\{pageSize\}/);
  assert.match(domesticApi, /OFFSET \$\{offset\}/);
  assert.match(domesticApi, /findDomesticLogisticsOrdersForList\(pageOrderIds\)/);
  assert.match(domesticApi, /id: \{ in: orderIds \}/);
  assert.match(domesticApi, /totalPages: Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)/);
  assert.match(domesticModule, /pageSize: String\(PAGE_SIZE\)/);
  assert.match(domesticModule, /setTotal\(Number\(result\.total \|\| 0\)\)/);
  assert.match(domesticModule, /onPageChange=\{gotoPage\}/);
  assert.match(domesticView, /PaginationBar[\s\S]*onPage=\{onPageChange\}/);
  assert.doesNotMatch(domesticModule, /rows\.slice\(start, start \+ PAGE_SIZE\)/);
});

test("high traffic list controllers ignore stale slower responses", () => {
  for (const file of guardedListControllers) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /listRequestRef|loadCostsDataRequestRef/, `${file} should keep a request sequence ref`);
    assert.match(source, /requestId !== listRequestRef\.current|dataRequestId !== loadCostsDataRequestRef\.current/, `${file} should ignore stale responses`);
    assert.match(source, /requestId === listRequestRef\.current|visibleRequestId === loadCostsVisibleRequestRef\.current/, `${file} should only clear visible loading for the active response`);
  }
});
