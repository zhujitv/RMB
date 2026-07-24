import assert from "node:assert/strict";
import test from "node:test";
import {
  readCustomerCommunicationModuleSource,
  readDomesticLogisticsApiSource,
  readDomesticLogisticsModuleSource,
  readLogisticsFeesModuleSource,
  readOrdersModuleSource,
  readPaymentsModuleSource,
  readProfitModuleSource,
  readTaxRefundModuleSource,
} from "./source-helpers.ts";

const domesticApi = readDomesticLogisticsApiSource();
const domesticModule = readDomesticLogisticsModuleSource();
const domesticView = domesticModule;

const guardedListControllers = [
  ["orders", readOrdersModuleSource()],
  ["payments", readPaymentsModuleSource()],
  ["profit", readProfitModuleSource()],
  ["customer communication", readCustomerCommunicationModuleSource()],
  ["domestic logistics", readDomesticLogisticsModuleSource()],
  ["tax refund", readTaxRefundModuleSource()],
  ["logistics fees", readLogisticsFeesModuleSource()],
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
  for (const [label, source] of guardedListControllers) {
    assert.match(source, /listRequestRef|loadCostsDataRequestRef/, `${label} should keep a request sequence ref`);
    assert.match(source, /requestId !== listRequestRef\.current|dataRequestId !== loadCostsDataRequestRef\.current/, `${label} should ignore stale responses`);
    assert.match(source, /requestId === listRequestRef\.current|visibleRequestId === loadCostsVisibleRequestRef\.current/, `${label} should only clear visible loading for the active response`);
  }
});
