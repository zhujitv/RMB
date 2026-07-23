import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPLIER_DOCUMENT_REQUEST_TERMINAL_STATUSES,
  isSupplierDocumentRequestTerminalStatus,
  supplierDocumentRequestRankingPagePlan,
} from "../lib/platform/supplier-document-request-ranking.ts";

test("supplier document request ranking treats completed and closed tasks as terminal", () => {
  assert.deepEqual(SUPPLIER_DOCUMENT_REQUEST_TERMINAL_STATUSES, ["已完成", "已关闭"]);
  assert.equal(isSupplierDocumentRequestTerminalStatus("已完成"), true);
  assert.equal(isSupplierDocumentRequestTerminalStatus(" 已关闭 "), true);
  assert.equal(isSupplierDocumentRequestTerminalStatus("部分上传"), false);
  assert.equal(isSupplierDocumentRequestTerminalStatus("待上传"), false);
});

test("supplier document request ranking fills each page with actionable tasks first", () => {
  assert.deepEqual(supplierDocumentRequestRankingPagePlan(1, 10, 13), {
    actionable: { skip: 0, take: 10 },
    terminal: { skip: 0, take: 0 },
  });
  assert.deepEqual(supplierDocumentRequestRankingPagePlan(2, 10, 13), {
    actionable: { skip: 10, take: 3 },
    terminal: { skip: 0, take: 7 },
  });
  assert.deepEqual(supplierDocumentRequestRankingPagePlan(3, 10, 13), {
    actionable: { skip: 13, take: 0 },
    terminal: { skip: 7, take: 10 },
  });
});

test("supplier document request ranking handles pages with no actionable tasks", () => {
  assert.deepEqual(supplierDocumentRequestRankingPagePlan(1, 20, 0), {
    actionable: { skip: 0, take: 0 },
    terminal: { skip: 0, take: 20 },
  });
});
