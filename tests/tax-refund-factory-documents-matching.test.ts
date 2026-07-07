import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti") as {
  createJiti: (url: string) => { import: (id: string) => Promise<Record<string, unknown>> };
};
const { taxDocumentCompleteness } = await createJiti(import.meta.url).import("../lib/platform/shared-tax-completeness-calculator.ts") as {
  taxDocumentCompleteness: (order: Record<string, unknown>) => Record<string, any>;
};

function factoryCost(overrides: Record<string, unknown> = {}) {
  return {
    id: "cost-1",
    supplierId: "supplier-a",
    supplierNameSnapshot: "安徽森泰木塑集团股份有限公司",
    supplierType: "工厂供应商",
    costType: "工厂货款",
    amount: 100,
    amountCny: 100,
    currency: "CNY",
    status: "ACTIVE",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function supplierDocument(costId: string | null, documentType: "SUPPLIER_PURCHASE_CONTRACT" | "SUPPLIER_INVOICE", supplierId = "supplier-a") {
  return {
    id: `${documentType}-${costId || supplierId}`,
    costId,
    supplierId,
    documentType,
    relatedModule: "SUPPLIER",
    uploadStatus: "SUCCESS",
    fileName: `${documentType}.pdf`,
  };
}

function completeFactoryDocuments(costId: string, supplierId = "supplier-a") {
  return [
    supplierDocument(costId, "SUPPLIER_PURCHASE_CONTRACT", supplierId),
    supplierDocument(costId, "SUPPLIER_INVOICE", supplierId),
  ];
}

function completenessFor(costs: ReturnType<typeof factoryCost>[], documents: ReturnType<typeof supplierDocument>[]) {
  return taxDocumentCompleteness({
    costs,
    documents,
    domesticLogisticsInfo: {
      destinationPlace: "ROTTERDAM",
      cargoDescription: "WPC",
      remarkText: "已录入物流信息",
    },
  });
}

test("voided factory costs do not create product supplier missing issues", () => {
  const activeCost = factoryCost({ id: "active-cost", amount: 133066.79, amountCny: 133066.79 });
  const voidedCost = factoryCost({ id: "voided-cost", amount: 132254.29, amountCny: 132254.29, status: "VOID" });
  const result = completenessFor([activeCost, voidedCost], completeFactoryDocuments("active-cost"));

  assert.equal(result.supplier.total, 2);
  assert.equal(result.supplier.completed, 2);
  assert.deepEqual(result.supplier.missing, []);
  assert.doesNotMatch((result.missingLabels || []).join(" / "), /产品供应商资料缺失|安徽森泰木塑集团股份有限公司/);
});

test("duplicate shadow factory costs prefer the row with uploaded contract and invoice", () => {
  const withFiles = factoryCost({
    id: "cost-with-files",
    documents: completeFactoryDocuments("cost-with-files"),
  });
  const emptyDuplicate = factoryCost({ id: "cost-empty-duplicate" });
  const result = completenessFor([withFiles, emptyDuplicate], completeFactoryDocuments("cost-with-files"));

  assert.equal(result.supplier.total, 2);
  assert.equal(result.supplier.completed, 2);
  assert.deepEqual(result.supplier.missing, []);
});

test("same supplier multiple factory payments stay separate when amounts differ", () => {
  const first = factoryCost({ id: "first-cost", amount: 100, amountCny: 100 });
  const second = factoryCost({ id: "second-cost", amount: 200, amountCny: 200 });
  const result = completenessFor([first, second], completeFactoryDocuments("first-cost"));

  assert.equal(result.supplier.total, 4);
  assert.equal(result.supplier.completed, 2);
  assert.equal(result.supplier.missing.length, 2);
  assert.equal(result.supplier.missing.every((item) => item.costId === "second-cost"), true);
});

test("same supplier same named payments without uploaded files are not collapsed", () => {
  const first = factoryCost({ id: "first-empty-cost" });
  const second = factoryCost({ id: "second-empty-cost" });
  const result = completenessFor([first, second], []);

  assert.equal(result.supplier.total, 4);
  assert.equal(result.supplier.completed, 0);
  assert.equal(result.supplier.missing.length, 4);
});

test("legacy supplier-level documents only match when there is one factory payment for that supplier", () => {
  const oneCost = factoryCost({ id: "single-cost" });
  const legacyDocs = [
    supplierDocument(null, "SUPPLIER_PURCHASE_CONTRACT"),
    supplierDocument(null, "SUPPLIER_INVOICE"),
  ];
  const singleResult = completenessFor([oneCost], legacyDocs);

  assert.equal(singleResult.supplier.total, 2);
  assert.equal(singleResult.supplier.completed, 2);

  const first = factoryCost({ id: "first-cost", amount: 100, amountCny: 100 });
  const second = factoryCost({ id: "second-cost", amount: 200, amountCny: 200 });
  const multiResult = completenessFor([first, second], legacyDocs);

  assert.equal(multiResult.supplier.total, 4);
  assert.equal(multiResult.supplier.completed, 0);
  assert.equal(multiResult.supplier.missing.length, 4);
});

test("multiple suppliers and multiple factory payments pass when each cost slot has documents", () => {
  const firstSupplier = factoryCost({ id: "supplier-a-cost-1", supplierId: "supplier-a", amount: 100, amountCny: 100 });
  const firstSupplierSecondPayment = factoryCost({ id: "supplier-a-cost-2", supplierId: "supplier-a", amount: 200, amountCny: 200 });
  const secondSupplier = factoryCost({
    id: "supplier-b-cost-1",
    supplierId: "supplier-b",
    supplierNameSnapshot: "安徽科蓝特铝业股份有限公司",
    amount: 300,
    amountCny: 300,
  });
  const documents = [
    ...completeFactoryDocuments("supplier-a-cost-1", "supplier-a"),
    ...completeFactoryDocuments("supplier-a-cost-2", "supplier-a"),
    ...completeFactoryDocuments("supplier-b-cost-1", "supplier-b"),
  ];
  const result = completenessFor([firstSupplier, firstSupplierSecondPayment, secondSupplier], documents);

  assert.equal(result.supplier.total, 6);
  assert.equal(result.supplier.completed, 6);
  assert.deepEqual(result.supplier.missing, []);
});
