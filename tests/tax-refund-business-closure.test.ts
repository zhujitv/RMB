import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readLogisticsExpenseAccessSource,
  readLogisticsExpensePaymentSource,
  readLogisticsExpenseQueriesSource,
  readPaymentsServiceSource,
  readTaxRefundActionsSource,
  readTaxRefundSharedSource,
} from "./source-helpers.ts";

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

test("tax refund closure accepts the legacy system-generated logistics cost source", () => {
  const row = settledRow();
  row.cost = { ...row.cost!, sourceType: "LOGISTICS_EXPENSE" };
  const result = analyzeTaxRefundLogisticsClosure([row]);

  assert.equal(result.complete, true);
  assert.deepEqual(result.blockers, []);
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

test("tax refund closure accepts a historical paid cost whose redundant paid flag was not populated", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({
      cost: {
        ...settledRow().cost!,
        paymentStatus: "已支付",
        paid: false,
        paymentDate: "2026-07-10",
      },
    }),
  ]);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.blockers, []);
});

test("tax refund closure still blocks a paid status without a payment date", () => {
  const summary = analyzeTaxRefundLogisticsClosure([
    settledRow({
      cost: {
        ...settledRow().cost!,
        paymentStatus: "已支付",
        paid: false,
        paymentDate: null,
      },
    }),
  ]);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.blockers[0].reasons, ["成本付款状态未同步（当前：已支付）"]);
});

test("legacy logistics payment reconciliation only updates exact paid-bill matches", () => {
  const migration = readFileSync(
    new URL(
      "../prisma/migrations/20260810150000_reconcile_legacy_logistics_cost_payments/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /UPDATE "order_costs" AS cost/);
  assert.match(migration, /"paid" = TRUE/);
  assert.match(migration, /"paid_at" = bill\."payment_date"/);
  assert.match(migration, /bill\."audit_status" = '审核通过'/);
  assert.match(migration, /bill\."payment_status" IN \('已付款', '已支付'\)/);
  assert.match(migration, /cost\."source_id" = expense\."id"/);
  assert.match(migration, /cost\."order_id" = expense\."order_id"/);
  assert.match(migration, /cost\."supplier_id" IS NOT DISTINCT FROM expense\."supplier_id"/);
  assert.match(migration, /cost\."cost_type" = expense\."cost_type"/);
  assert.match(migration, /cost\."currency" = expense\."currency"/);
  assert.match(migration, /cost\."amount" = expense\."amount"/);
  assert.match(migration, /cost\."amount_cny" = expense\."amount_cny"/);
  assert.match(migration, /cost\."payment_status" IN \('已支付', '已付款'\)/);
  assert.match(migration, /cost\."payment_date" = bill\."payment_date"/);
  const setClause = migration.slice(migration.indexOf("SET"), migration.indexOf("FROM"));
  assert.doesNotMatch(setClause, /"payment_status"\s*=/);
  assert.doesNotMatch(setClause, /"payment_date"\s*=/);
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
  const taxActions = readTaxRefundActionsSource();
  const taxShared = readTaxRefundSharedSource();
  const payments = readPaymentsServiceSource();
  const logisticsQueries = readLogisticsExpenseQueriesSource();
  const logisticsMutations = readLogisticsExpenseAccessSource();
  const logisticsInvoiceWorkflow = readLogisticsExpensePaymentSource();
  const statusStart = taxActions.indexOf("export async function updateTaxRefundStatus");
  const cancelStart = taxActions.indexOf("export async function cancelTaxRefundArchive", statusStart);
  const settleStart = taxActions.indexOf("export async function settleCommission", cancelStart);
  assert.ok(statusStart >= 0 && cancelStart > statusStart && settleStart > cancelStart);
  const statusMutation = taxActions.slice(statusStart, cancelStart);
  const cancelMutation = taxActions.slice(cancelStart, settleStart);
  assert.match(taxActions, /const EDITABLE_TAX_REFUND_STATUSES = \["NOT_READY", "READY", "PROBLEM", "SUBMITTED"\]/);
  assert.match(taxActions, /const TAX_REFUND_STATUS_TRANSACTION_OPTIONS = \{[\s\S]*isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(taxActions, /function runTaxRefundStatusTransaction/);
  assert.match(statusMutation, /runTaxRefundStatusTransaction\(async \(tx\) =>/);
  assert.match(statusMutation, /await lockBusinessOrderForUpdate\(tx, orderId\)/);
  assert.match(statusMutation, /hydrateTaxRefundOrderLogisticsInfo\(before, tx\)/);
  assert.match(statusMutation, /exchangeRateSettingsInTransaction\(tx\)/);
  assert.match(statusMutation, /await assertTaxRefundLogisticsBusinessClosure\(orderId, tx\)/);
  assert.match(statusMutation, /tx\.receivableOrder\.updateMany\(\{[\s\S]*updatedAt: before\.updatedAt,[\s\S]*taxRefundCompletenessUpdatedAt: before\.taxRefundCompletenessUpdatedAt/);
  assert.match(statusMutation, /if \(updated\.count !== 1\) throw taxRefundStatusSerializationConflict\(\)/);
  assert.match(statusMutation, /writeAudit\([\s\S]*taxRefundCompletenessUpdatedAt: mutationVersion,[\s\S]*tx,[\s\S]*\);/);
  assert.ok(statusMutation.indexOf("lockBusinessOrderForUpdate") < statusMutation.indexOf("receivableOrder.findFirst"));
  assert.ok(statusMutation.indexOf("hydrateTaxRefundOrderLogisticsInfo(before, tx)") < statusMutation.indexOf("exchangeRateSettingsInTransaction(tx)"));
  assert.ok(statusMutation.indexOf("assertTaxRefundLogisticsBusinessClosure") < statusMutation.indexOf("receivableOrder.updateMany"));
  assert.match(cancelMutation, /runTaxRefundStatusTransaction\(async \(tx\) =>/);
  assert.match(cancelMutation, /await lockBusinessOrderForUpdate\(tx, orderId\)/);
  assert.match(cancelMutation, /hydrateTaxRefundOrderLogisticsInfo\(before, tx\)/);
  assert.match(cancelMutation, /tx\.receivableOrder\.updateMany\(\{[\s\S]*updatedAt: before\.updatedAt,[\s\S]*taxRefundCompletenessUpdatedAt: before\.taxRefundCompletenessUpdatedAt/);
  assert.match(cancelMutation, /writeAudit\([\s\S]*"取消归档"[\s\S]*tx,[\s\S]*\);/);
  assert.match(taxShared, /hydrateTaxRefundOrderLogisticsInfo\([\s\S]*client: Prisma\.TransactionClient \| typeof prisma = prisma/);
  assert.match(taxShared, /client\.logisticsBill/);
  assert.match(taxShared, /client\.receivableOrder/);
  assert.doesNotMatch(taxActions.match(/const EDITABLE_TAX_REFUND_STATUSES[^;]+/)?.[0] || "", /REFUND_RECEIVED/);
  assert.doesNotMatch(payments, /assertBusinessNotArchived|assertBusinessOrderWritableInTransaction|BUSINESS_ARCHIVED_READ_ONLY/);
  assert.match(logisticsQueries, /businessArchiveOrderWhere\(filters\.businessScope\)/);
  assert.match(logisticsQueries, /businessArchiveOrderWhere\("current"\)/);
  assert.match(logisticsMutations, /assertBusinessNotArchived\(expense\.order/);
  const paymentStart = logisticsInvoiceWorkflow.indexOf("export async function updateLogisticsExpensePaymentStatus");
  assert.ok(paymentStart >= 0);
  const paymentSource = logisticsInvoiceWorkflow.slice(paymentStart);
  assert.match(paymentSource, /prisma\.\$transaction/);
  assert.match(paymentSource, /syncApprovedLogisticsExpenseCosts\(tx, currentRows, actor(?:, \{[\s\S]*?\})?\)/);
  assert.match(paymentSource, /costUpdate\.count !== costIds\.length/);
  assert.doesNotMatch(paymentSource, /orderCost\.updateMany\([\s\S]*?\.catch\(\(\) => null\)/);
});
