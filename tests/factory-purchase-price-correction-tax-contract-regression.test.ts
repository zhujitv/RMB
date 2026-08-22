import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { Prisma } from "../lib/generated/prisma/client.js";

const contractFinancialsSource = readFileSync(
  "lib/platform/factory-purchase-price-correction-contract.ts",
  "utf8",
);
const contractRequestSource = readFileSync(
  "lib/platform/supplier-tax-contract-request-create.ts",
  "utf8",
);

function exportedFunctionSource(name: string, source: string) {
  const start = source.indexOf(`export function ${name}`);
  assert.notEqual(start, -1, `缺少导出函数 ${name}`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `函数 ${name} 缺少函数体`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`函数 ${name} 缺少结束括号`);
}

const correctedFactoryGoodsAmount = new Function(
  "Prisma",
  "codedError",
  `${ts.transpileModule(
    exportedFunctionSource("correctedFactoryGoodsAmount", contractFinancialsSource)
      .replace("export function", "function"),
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText}\nreturn correctedFactoryGoodsAmount;`,
)(Prisma, (message: string) => new Error(message)) as (
  baseAmount: Prisma.Decimal,
  corrections: Array<{
    purchaseOrderItemId: string;
    oldUnitPrice: Prisma.Decimal;
    newUnitPrice: Prisma.Decimal;
  }>,
  items: Array<{ id: string; actualDeliveredQuantity: Prisma.Decimal | null }>,
) => Prisma.Decimal;

function decimal(value: string | number) {
  return new Prisma.Decimal(value);
}

test("tax contract price correction uses actual delivered quantity instead of planned quantity", () => {
  const baseAmount = decimal(800);
  const corrected = correctedFactoryGoodsAmount(
    baseAmount,
    [{
      purchaseOrderItemId: "item-1",
      oldUnitPrice: decimal(10),
      newUnitPrice: decimal(12),
    }],
    [{ id: "item-1", actualDeliveredQuantity: decimal(80) }],
  );

  assert.equal(corrected.toFixed(2), "960.00");
  assert.equal(corrected.sub(baseAmount).toFixed(2), "160.00");
});

test("sequential price corrections telescope on actual delivered quantity", () => {
  const baseAmount = decimal(800);
  const corrected = correctedFactoryGoodsAmount(
    baseAmount,
    [
      {
        purchaseOrderItemId: "item-1",
        oldUnitPrice: decimal(10),
        newUnitPrice: decimal(12),
      },
      {
        purchaseOrderItemId: "item-1",
        oldUnitPrice: decimal(12),
        newUnitPrice: decimal(11),
      },
    ],
    [{ id: "item-1", actualDeliveredQuantity: decimal(80) }],
  );

  assert.equal(corrected.toFixed(2), "880.00");
  assert.equal(corrected.sub(baseAmount).toFixed(2), "80.00");
});

test("pending price corrections block tax contract generation and review", () => {
  assert.match(
    contractFinancialsSource,
    /where:\s*\{\s*status:\s*\{\s*in:\s*\["PENDING",\s*"APPROVED"\]\s*\}\s*\}/,
  );
  assert.match(
    contractFinancialsSource,
    /priceCorrections\.some\(\(correction\)\s*=>\s*correction\.status\s*===\s*"PENDING"\)/,
  );
  assert.match(contractFinancialsSource, /SUPPLIER_TAX_CONTRACT_PRICE_CORRECTION_PENDING/);
});

test("tax contract creation locks purchase order before receivable order", () => {
  const purchaseOrderLock = contractRequestSource.indexOf(
    "await lockFactoryPurchaseOrder(tx, draft.purchaseOrderId);",
  );
  const receivableOrderLock = contractRequestSource.indexOf(
    "await assertBusinessOrderWritableInTransaction(tx, order.id",
  );

  assert.notEqual(purchaseOrderLock, -1, "缺少采购单行锁");
  assert.notEqual(receivableOrderLock, -1, "缺少应收订单行锁");
  assert.ok(purchaseOrderLock < receivableOrderLock, "必须按采购单→应收订单顺序加锁");
});

test("transaction conflicts are not reported as duplicate document requests", () => {
  assert.match(
    contractRequestSource,
    /if\s*\(code\s*===\s*"P2002"\)\s*throw duplicateSupplierDocumentRequestError\(\)/,
  );
  assert.match(
    contractRequestSource,
    /if\s*\(code\s*===\s*"P2034"\)[\s\S]*?SUPPLIER_TAX_CONTRACT_CONCURRENT_UPDATE/,
  );
  assert.doesNotMatch(
    contractRequestSource,
    /\["P2002",\s*"P2034"\][\s\S]{0,160}duplicateSupplierDocumentRequestError\(\)/,
  );
});

test("price correction reuses the shared supplier document occupancy guard", () => {
  assert.match(
    contractFinancialsSource,
    /import\s*\{\s*supplierDocumentRequestCostOccupancy\s*\}\s*from\s*"\.\/supplier-document-request-availability"/,
  );
  assert.match(
    contractFinancialsSource,
    /supplierDocumentRequestCostOccupancy\(cost,\s*client\)/,
  );
  assert.match(contractFinancialsSource, /if\s*\(!occupancy\.occupied\)\s*return/);
});
