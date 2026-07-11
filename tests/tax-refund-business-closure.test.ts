import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  analyzeTaxRefundLogisticsClosure,
  type TaxRefundLogisticsClosureRow,
} from "../lib/platform/tax-refund-business-closure-rules.ts";

function settledRow(overrides: Partial<TaxRefundLogisticsClosureRow> = {}): TaxRefundLogisticsClosureRow {
  return {
    id: "expense-1",
    orderId: "order-1",
    supplierId: "supplier-1",
    costId: "cost-1",
    costType: "拖车费",
    amount: 120,
    amountCny: 120,
    currency: "CNY",
    supplierNameSnapshot: "测试物流供应商",
    auditStatus: "草稿",
    invoiceStatus: "未通知",
    paymentStatus: "待开票",
    invoiceDocumentId: "document-1",
    invoiceValidationStatus: "校验通过",
    bill: {
      id: "bill-1",
      status: "normal",
      auditStatus: "审核通过",
      invoiceStatus: "已上传发票",
      paymentStatus: "已付款",
      paymentDate: "2026-07-10",
    },
    cost: {
      id: "cost-1",
      orderId: "order-1",
      supplierId: "supplier-1",
      costType: "拖车费",
      currency: "CNY",
      amount: 120,
      amountCny: 120,
      sourceType: "LOGISTICS_FEE",
      sourceId: "expense-1",
      invoiceStatus: "已收到",
      paymentStatus: "已支付",
      paid: true,
      paymentDate: "2026-07-10",
      status: "ACTIVE",
    },
    invoiceDocument: {
      id: "document-1",
      uploadStatus: "SUCCESS",
    },
    ...overrides,
  };
}

test("tax refund closure uses bill-level paid state and accepts a settled logistics fee", () => {
  const summary = analyzeTaxRefundLogisticsClosure([settledRow()]);
  assert.equal(summary.activeExpenseCount, 1);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.blockers, []);
});

test("a paid historical fee with a valid invoice file does not depend on legacy OCR status", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({ invoiceValidationStatus: "未上传" }),
  ]);
  assert.equal(summary.complete, true);
});

test("tax refund closure reports readable invoice and payment blockers", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({
      invoiceDocumentId: null,
      invoiceDocument: null,
      invoiceValidationStatus: "未上传",
      bill: {
        id: "bill-1",
        status: "normal",
        auditStatus: "待审核",
        invoiceStatus: "待开票",
        paymentStatus: "部分付款",
      },
    }),
  ]);
  assert.equal(summary.complete, false);
  assert.equal(summary.blockers.length, 1);
  assert.match(summary.blockers[0].label, /拖车费.*CNY 120\.00/);
  assert.deepEqual(summary.blockers[0].reasons, [
    "审核状态为待审核",
    "物流发票未上传完整",
    "付款状态为部分付款",
  ]);
});

test("legacy partial-paid wording is not treated as fully settled", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({
      bill: {
        id: "bill-partial",
        status: "normal",
        auditStatus: "审核通过",
        invoiceStatus: "已上传发票",
        paymentStatus: "部分已付款",
      },
    }),
  ]);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.blockers[0].reasons, ["付款状态为部分付款"]);
});

test("tax refund closure blocks an approved logistics fee without a cost record", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({ costId: null, cost: null }),
  ]);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.blockers[0].reasons, ["成本管理中未生成对应成本"]);
});

test("tax refund closure blocks a paid bill whose cost payment was not synchronized", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({
      cost: {
        ...settledRow().cost!,
        paymentStatus: "待支付",
        paid: false,
        paymentDate: null,
      },
    }),
  ]);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.blockers[0].reasons, ["成本付款状态未同步（当前：待支付）"]);
});

test("tax refund closure blocks a logistics cost with an invalid source link", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({
      cost: {
        ...settledRow().cost!,
        sourceType: "MANUAL",
        sourceId: null,
      },
    }),
  ]);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.blockers[0].reasons, ["成本来源关联异常"]);
});

test("voided and deleted logistics fees do not block tax refund closure", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({ bill: { id: "bill-void", status: "voided" } }),
    settledRow({ id: "expense-deleted", deletedAt: new Date() }),
  ]);
  assert.equal(summary.activeExpenseCount, 0);
  assert.equal(summary.complete, true);
});

test("profit analysis query remains independent from tax refund archive status", () => {
  const source = readFileSync(new URL("../lib/platform/profit-overview.ts", import.meta.url), "utf8");
  const start = source.indexOf("function profitFilterWhere");
  const end = source.indexOf("function serializeProfitAnalysisOrder", start);
  assert.ok(start >= 0 && end > start);
  const profitWhereSource = source.slice(start, end);
  assert.doesNotMatch(profitWhereSource, /taxArchived|taxRefundStatus|taxRefundArchivedAt|taxSubmittedAt/);
});

test("tax refund submit and logistics mutations are wired to the closure archive guard", () => {
  const taxActions = readFileSync(new URL("../lib/platform/tax-refunds-actions.ts", import.meta.url), "utf8");
  const logisticsQueries = readFileSync(new URL("../lib/platform/logistics-expense-queries.ts", import.meta.url), "utf8");
  const logisticsMutations = readFileSync(new URL("../lib/platform/logistics-expense-access-mutations.ts", import.meta.url), "utf8");
  const logisticsInvoiceWorkflow = readFileSync(new URL("../lib/platform/logistics-expense-workflow-invoice.ts", import.meta.url), "utf8");
  assert.match(taxActions, /const EDITABLE_TAX_REFUND_STATUSES = \["NOT_READY", "READY", "PROBLEM", "SUBMITTED"\]/);
  assert.match(taxActions, /await lockBusinessOrderForUpdate\(tx, orderId\)/);
  assert.match(taxActions, /await assertTaxRefundLogisticsBusinessClosure\(orderId, tx\)/);
  assert.match(taxActions, /return tx\.receivableOrder\.update/);
  assert.doesNotMatch(taxActions.match(/const EDITABLE_TAX_REFUND_STATUSES[^;]+/)?.[0] || "", /REFUND_RECEIVED/);
  assert.match(logisticsQueries, /businessArchiveOrderWhere\(filters\.businessScope\)/);
  assert.match(logisticsQueries, /businessArchiveOrderWhere\("current"\)/);
  assert.match(logisticsMutations, /assertBusinessNotArchived\(expense\.order/);
  const paymentStart = logisticsInvoiceWorkflow.indexOf("export async function updateLogisticsExpensePaymentStatus");
  assert.ok(paymentStart >= 0);
  const paymentSource = logisticsInvoiceWorkflow.slice(paymentStart);
  assert.match(paymentSource, /prisma\.\$transaction/);
  assert.match(paymentSource, /syncApprovedLogisticsExpenseCosts\(tx, currentRows, actor\)/);
  assert.match(paymentSource, /costUpdate\.count !== costIds\.length/);
  assert.doesNotMatch(paymentSource, /orderCost\.updateMany\([\s\S]*?\.catch\(\(\) => null\)/);
});
