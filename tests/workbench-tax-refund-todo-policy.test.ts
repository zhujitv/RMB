import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { forEachTaxRefundTodoPage, isOnlyExportInvoiceMissing } from "../lib/platform/workbench-tax-refund-todo-policy.ts";
import { readOrderDocumentsSource, readSharedTaxCompletenessSource, readWorkbenchTodosSource } from "./source-helpers.ts";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
const require = createRequire(import.meta.url);
const { createJiti } = require("jiti") as {
  createJiti: (url: string) => { import: (id: string) => Promise<Record<string, unknown>> };
};
const { taxDocumentCompleteness } = await createJiti(import.meta.url).import("../lib/platform/shared-tax-completeness-calculator.ts") as {
  taxDocumentCompleteness: (order: Record<string, unknown>) => Record<string, any>;
};
const { isTaxRefundExportInvoiceFinanceUser } = await createJiti(import.meta.url).import("../lib/platform/workbench-todos-context.ts") as {
  isTaxRefundExportInvoiceFinanceUser: (user: Record<string, unknown>) => boolean;
};
const { canAccessOrder } = await createJiti(import.meta.url).import("../lib/platform/order-access.ts") as {
  canAccessOrder: (user: Record<string, unknown>, order: Record<string, unknown>) => boolean;
};
const sharedCompletenessSource = readSharedTaxCompletenessSource();
const taxSyncSource = readFileSync("lib/platform/shared-tax-sync.ts", "utf8");
const taxTodoSource = readWorkbenchTodosSource();
const orderDocumentUploadSource = readOrderDocumentsSource();
const orderDocumentFilesSource = orderDocumentUploadSource;

function completeness(overrides: Record<string, unknown> = {}) {
  return {
    complete: false,
    total: 12,
    completed: 11,
    missingTypes: ["EXPORT_INVOICE"],
    missingLabels: ["出口发票"],
    export: {
      total: 5,
      completed: 4,
      missingTypes: ["EXPORT_INVOICE"],
    },
    ...overrides,
  };
}

test("only the canonical single export-invoice gap is finance-only", () => {
  assert.equal(isOnlyExportInvoiceMissing(completeness()), true);
  assert.equal(isOnlyExportInvoiceMissing(completeness({ complete: true })), false);
  assert.equal(isOnlyExportInvoiceMissing(completeness({ completed: 10 })), false);
  assert.equal(isOnlyExportInvoiceMissing(completeness({ missingTypes: ["EXPORT_INVOICE", "PACKING_LIST"] })), false);
  assert.equal(isOnlyExportInvoiceMissing(completeness({ missingLabels: ["出口发票", "装箱单"] })), false);
  assert.equal(isOnlyExportInvoiceMissing(completeness({ missingLabels: ["商业发票"] })), false);
  assert.equal(isOnlyExportInvoiceMissing(completeness({
    export: { total: 5, completed: 3, missingTypes: ["EXPORT_INVOICE", "PACKING_LIST"] },
  })), false);
  assert.equal(isOnlyExportInvoiceMissing(null), false);
});

test("tax refund todo cursor pagination visits every row exactly once", async () => {
  const sourceRows = Array.from({ length: 205 }, (_, index) => ({ id: `order-${String(index).padStart(3, "0")}` }));
  const cursors: Array<string | null> = [];
  const pageLengths: number[] = [];
  const visitedIds: string[] = [];
  await forEachTaxRefundTodoPage(
    async (cursorId, pageSize) => {
      cursors.push(cursorId);
      const start = cursorId ? sourceRows.findIndex((row) => row.id === cursorId) + 1 : 0;
      return sourceRows.slice(start, start + pageSize);
    },
    (rows) => {
      pageLengths.push(rows.length);
      visitedIds.push(...rows.map((row) => row.id));
    },
    80,
  );
  assert.deepEqual(pageLengths, [80, 80, 45]);
  assert.deepEqual(cursors, [null, "order-079", "order-159"]);
  assert.deepEqual(visitedIds, sourceRows.map((row) => row.id));
});

test("legacy completeness caches are refreshed before finance-only routing", () => {
  assert.match(sharedCompletenessSource, /typeof cached\.complete !== "boolean"/);
  assert.match(sharedCompletenessSource, /!Array\.isArray\(cached\.missingTypes\) \|\| !Array\.isArray\(cached\.missingLabels\)/);
  assert.match(sharedCompletenessSource, /!Number\.isFinite\(Number\(cached\.total\)\)/);
  assert.match(sharedCompletenessSource, /!Number\.isFinite\(Number\(exportSection\.completed\)\)/);
  assert.match(sharedCompletenessSource, /!Array\.isArray\(exportSection\.missingTypes\)/);
});

test("export invoice reminders exclude finance users without effective access", () => {
  assert.equal(isTaxRefundExportInvoiceFinanceUser({ id: "finance-default", role: "财务" }), true);
  assert.equal(isTaxRefundExportInvoiceFinanceUser({
    id: "finance-tax-denied",
    role: "财务",
    customPermissions: {
      mode: "CUSTOM",
      reads: ["orders", "documents"],
      writes: ["documents"],
      dataScope: "ALL",
    },
  }), false);
  assert.equal(isTaxRefundExportInvoiceFinanceUser({
    id: "finance-upload-denied",
    role: "财务",
    customPermissions: {
      mode: "CUSTOM",
      reads: ["orders", "taxRefund", "documents"],
      writes: [],
      dataScope: "ALL",
    },
  }), false);
  assert.equal(isTaxRefundExportInvoiceFinanceUser({ id: "admin", role: "管理员" }), false);
  assert.equal(isTaxRefundExportInvoiceFinanceUser({
    id: "finance-menu-denied",
    role: "财务",
    customPermissions: {
      mode: "CUSTOM",
      menus: ["payments"],
      reads: ["orders", "taxRefund", "documents"],
      writes: ["documents"],
      dataScope: "ALL",
    },
  }), false);
});

test("finance reminder recipients must have an export-upload-compatible data scope", () => {
  const financeUser = {
    id: "finance-own-order",
    role: "财务",
    customPermissions: {
      mode: "CUSTOM",
      reads: ["orders", "taxRefund", "documents"],
      writes: ["documents"],
      dataScope: "OWN",
    },
  };
  assert.equal(isTaxRefundExportInvoiceFinanceUser(financeUser), true);
  assert.equal(canAccessOrder(financeUser, {
    salespersonUserId: financeUser.id,
  }), true);
  assert.equal(canAccessOrder(financeUser, {
    salespersonUserId: "another-user",
  }), false);
  assert.equal(isTaxRefundExportInvoiceFinanceUser({
    ...financeUser,
    customPermissions: { ...financeUser.customPermissions, dataScope: "OWN_COST" },
  }), false);
});

test("the real completeness calculator routes only the export-invoice-only gap", () => {
  const successfulDocument = (documentType: string, extra: Record<string, unknown> = {}) => ({
    id: `document-${documentType}`,
    documentType,
    uploadStatus: "SUCCESS",
    fileName: `${documentType}.pdf`,
    ...extra,
  });
  const factoryCost = {
    id: "factory-cost",
    supplierId: "factory-supplier",
    supplierNameSnapshot: "测试工厂",
    supplierType: "工厂供应商",
    costType: "工厂货款",
    amount: 100,
    currency: "CNY",
    status: "ACTIVE",
  };
  const documents = [
    "CUSTOMS_ENTRY_FORM",
    "RELEASE_NOTICE",
    "CUSTOMS_POWER_OF_ATTORNEY",
    "BILL_OF_LADING",
    "COMMERCIAL_INVOICE",
    "PACKING_LIST",
    "SALES_CONTRACT",
  ].map((type) => successfulDocument(type));
  documents.push(
    successfulDocument("SUPPLIER_PURCHASE_CONTRACT", { relatedModule: "SUPPLIER", costId: factoryCost.id, supplierId: factoryCost.supplierId }),
    successfulDocument("SUPPLIER_INVOICE", { relatedModule: "SUPPLIER", costId: factoryCost.id, supplierId: factoryCost.supplierId }),
  );
  const order = {
    tradeTerm: "EXW",
    costs: [factoryCost],
    documents,
    domesticLogisticsInfo: {
      destinationPlace: "ROTTERDAM",
      cargoDescription: "WPC",
      remarkText: "已录入物流信息",
    },
  };

  const exportInvoiceOnly = taxDocumentCompleteness(order);
  assert.deepEqual(exportInvoiceOnly.missingTypes, ["EXPORT_INVOICE"]);
  assert.equal(isOnlyExportInvoiceMissing(exportInvoiceOnly), true);

  const exportInvoiceAndPackingList = taxDocumentCompleteness({
    ...order,
    documents: documents.filter((document) => document.documentType !== "PACKING_LIST"),
  });
  assert.equal(isOnlyExportInvoiceMissing(exportInvoiceAndPackingList), false);
});

test("refreshed tax todos use one persisted completeness snapshot and skip failed refreshes", () => {
  assert.match(taxSyncSource, /refreshTaxRefundCompletenessBatchWithSnapshots/);
  assert.match(taxSyncSource, /select: \{ id: true, taxRefundCompleteness: true, taxRefundCompletenessUpdatedAt: true \}/);
  assert.match(taxSyncSource, /completeness: cachedTaxRefundCompleteness\(row\)/);
  assert.match(taxTodoSource, /if \(refreshRequiredOrderIdSet\.has\(order\.id\) && !refreshed\) continue/);
  assert.match(taxTodoSource, /taxRefundCompletenessUpdatedAt: refreshed\.completenessUpdatedAt/);
  assert.match(taxTodoSource, /dueAt: orderWithCompleteness\.taxRefundCompletenessUpdatedAt \|\| orderWithCompleteness\.updatedAt/);
  assert.match(taxTodoSource, /orderBy: \{ id: "asc" \}/);
  assert.doesNotMatch(taxTodoSource, /orderBy: \[\{ updatedAt: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(taxTodoSource, /cursor: \{ id: cursorId \}, skip: 1/);
});

test("export invoice mutations invalidate persisted completeness atomically and refresh without failing the mutation", () => {
  const invalidationFunction = taxSyncSource.match(/export async function invalidatePersistedTaxRefundCompleteness[\s\S]*?\n}/)?.[0] || "";
  assert.match(invalidationFunction, /tx\.\$executeRaw\(Prisma\.sql/);
  assert.match(invalidationFunction, /"tax_refund_completeness" = NULL/);
  assert.match(invalidationFunction, /"tax_refund_completeness_updated_at" = NULL/);
  assert.match(invalidationFunction, /"tax_refund_overall_completeness" = NULL/);
  assert.match(invalidationFunction, /"tax_refund_completeness_issues_summary" = NULL/);
  assert.doesNotMatch(invalidationFunction, /"updated_at"\s*=/);
  for (const source of [orderDocumentUploadSource, orderDocumentFilesSource]) {
    assert.match(source, /documentType === "EXPORT_INVOICE"/);
    assert.match(source, /invalidatePersistedTaxRefundCompleteness\(tx,/);
    assert.match(source, /await runNonCriticalTask\("出口发票/);
    assert.match(source, /if \(!refreshed\) throw new Error/);
    assert.match(source, /finally \{\s*invalidateWorkbenchTodosCache\(\)/);
  }
});
