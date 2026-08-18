import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import { recognizeTencentCustomsGoods } from "./tencent-customs-ocr-experiment";
import { codedError, nonEmpty } from "./shared-base-utils";

const ACTIVE_PURCHASE_ORDER_STATUSES = ["DISPATCHED", "ACCEPTED", "DELIVERY_PROPOSED"] as const;

export type SupplierTaxContractItemDraft = {
  lineNo: number;
  purchaseOrderItemId: string;
  customsItemNo: string;
  customsCommodityCode: string;
  productName: string;
  unit: string;
  quantity: string;
  declaredQuantity: string;
  unitPriceWithTax: string;
  amountWithTax: string;
};

export type SupplierTaxContractDraft = {
  contractNo: string;
  customerOrderNo: string;
  orderId: string;
  costId: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
  customsDocumentId: string;
  customsDeclarationNo: string;
  supplierId: string;
  supplierName: string;
  supplierTaxNumber: string;
  supplierAddress: string;
  supplierPhone: string;
  supplierBankName: string;
  supplierBankAccount: string;
  buyerBusinessEntityId: string;
  buyerName: string;
  buyerTaxNumber: string;
  buyerAddress: string;
  buyerPhone: string;
  buyerBankName: string;
  buyerBankAccount: string;
  signingPlace: string;
  signingDate: string;
  latestDeliveryDate: string;
  currency: string;
  totalAmountWithTax: string;
  items: SupplierTaxContractItemDraft[];
  customsSnapshot: Array<Record<string, unknown>>;
  warnings: string[];
  blockingIssues: string[];
  generatedAt: string;
  manualEditedAt?: string;
  ocrRequestIds: string[];
  sourceType?: string;
  transitionSettlementId?: string;
};

function dateText(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function decimalText(value: Prisma.Decimal, places: number) {
  const fixed = value.toFixed(places);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

function comparable(value: unknown) {
  return String(value || "").toUpperCase().replace(/[\s（）()【】\[\]，,。._\-\/\\]/g, "");
}

function matchScore(productName: string, unit: string, candidate: Record<string, unknown>) {
  const left = comparable(productName);
  const right = comparable(candidate.productName || candidate.nameAndSpecification);
  let score = left && right && left === right ? 100 : left && right && (left.includes(right) || right.includes(left)) ? 60 : 0;
  const units = Array.isArray(candidate.quantityUnits) ? candidate.quantityUnits as Array<Record<string, unknown>> : [];
  if (units.some((row) => comparable(row.unit) === comparable(unit))) score += 20;
  return score;
}

function candidateForItem(
  item: { productNameSnapshot: string; unitSnapshot: string },
  candidates: Array<Record<string, unknown>>,
  index: number,
) {
  return candidates
    .map((candidate) => ({ candidate, score: matchScore(item.productNameSnapshot, item.unitSnapshot, candidate) }))
    .sort((left, right) => right.score - left.score)[0]?.candidate || candidates[index] || null;
}

function quantityForUnit(candidate: Record<string, unknown>, preferredUnit: string) {
  const rows = Array.isArray(candidate.quantityUnits) ? candidate.quantityUnits as Array<Record<string, unknown>> : [];
  return rows.find((row) => comparable(row.unit) === comparable(preferredUnit)) || rows[0] || {};
}

export async function buildSupplierTaxContractDraft(costId: string) {
  const cost = await prisma.orderCost.findFirst({
    where: { id: costId, deletedAt: null, status: { not: "VOID" } },
    select: { id: true, orderId: true, supplierId: true, sourceType: true, sourceId: true },
  });
  if (!cost || !cost.supplierId || cost.sourceType !== "FACTORY_PURCHASE_SETTLEMENT" || !cost.sourceId) {
    throw codedError("只有工厂采购最终结算生成的成本才能自动生成退税合同。", 400, "SUPPLIER_TAX_CONTRACT_SOURCE_REQUIRED");
  }
  const purchaseOrder = await prisma.factoryPurchaseOrder.findFirst({
    where: { id: cost.sourceId, supplierId: cost.supplierId, status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] } },
    include: {
      supplier: true,
      settlement: true,
      items: { include: { supplierPrice: true }, orderBy: [{ lineNumber: "asc" }] },
      execution: {
        include: {
          businessEntity: { include: { bankAccounts: { where: { currency: "CNY" } } } },
          receivableOrder: true,
          purchaseOrders: {
            where: { status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] } },
            select: {
              id: true,
              sequenceNo: true,
              items: { select: { productNameSnapshot: true, unitSnapshot: true, actualDeliveredQuantity: true } },
            },
            orderBy: [{ sequenceNo: "asc" }],
          },
        },
      },
    },
  });
  if (!purchaseOrder?.settlement || !purchaseOrder.execution.receivableOrder) {
    throw codedError("采购单尚未完成最终结算或未生成应收订单，不能生成退税合同。", 409, "SUPPLIER_TAX_CONTRACT_SETTLEMENT_REQUIRED");
  }
  const customsDocument = await prisma.orderDocument.findFirst({
    where: {
      orderId: cost.orderId,
      documentType: "CUSTOMS_ENTRY_FORM",
      uploadStatus: "SUCCESS",
      deletedAt: null,
    },
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!customsDocument?.storageKey) {
    throw codedError("请先在退税资料上传有效报关单 PDF。", 400, "CUSTOMS_DOCUMENT_REQUIRED");
  }
  const customs = await recognizeTencentCustomsGoods(await readR2Object(customsDocument.storageKey));
  const candidates = customs.items as Array<Record<string, unknown>>;
  const warnings = [...customs.warnings];
  const blockingIssues: string[] = [];
  const items = purchaseOrder.items.map((item, index): SupplierTaxContractItemDraft => {
    if (item.actualDeliveredQuantity == null) {
      throw codedError(`采购单第${item.lineNumber}行尚未确认实际装柜数量。`, 409, "ACTUAL_LOADED_QUANTITY_REQUIRED");
    }
    const price = item.supplierPrice?.unitPrice ?? item.purchaseUnitPrice;
    if (price == null) throw codedError(`采购单第${item.lineNumber}行缺少确认含税单价。`, 409, "SUPPLIER_UNIT_PRICE_REQUIRED");
    const candidate = candidateForItem(item, candidates, index);
    if (!candidate) throw codedError("报关单商品行数量不足，无法生成合同草稿。", 422, "CUSTOMS_ITEM_MAPPING_REQUIRED");
    const customsQuantity = quantityForUnit(candidate, item.unitSnapshot);
    const quantity = new Prisma.Decimal(item.actualDeliveredQuantity);
    const unitPrice = new Prisma.Decimal(price);
    const amount = quantity.mul(unitPrice).toDecimalPlaces(2);
    const productName = nonEmpty(candidate.productName || candidate.nameAndSpecification);
    const unit = nonEmpty(customsQuantity.unit || item.unitSnapshot);
    const declaredQuantity = nonEmpty(customsQuantity.quantity);
    if (matchScore(item.productNameSnapshot, item.unitSnapshot, candidate) < 60) {
      blockingIssues.push(`采购第${item.lineNumber}行无法可靠匹配报关单商品，请先修正报关单识别或商品资料。`);
    }
    if (comparable(item.productNameSnapshot) !== comparable(productName)) {
      warnings.push(`采购第${item.lineNumber}行品名“${item.productNameSnapshot}”已按报关品名“${productName}”生成，请人工核查。`);
    }
    if (comparable(item.unitSnapshot) !== comparable(unit)) {
      warnings.push(`采购第${item.lineNumber}行单位“${item.unitSnapshot}”与报关单位“${unit}”不同，请人工确认换算依据。`);
    }
    return {
      lineNo: index + 1,
      purchaseOrderItemId: item.id,
      customsItemNo: nonEmpty(candidate.itemNo) || String(index + 1),
      customsCommodityCode: nonEmpty(candidate.commodityCode),
      productName,
      unit,
      quantity: decimalText(quantity, 4),
      declaredQuantity,
      unitPriceWithTax: decimalText(unitPrice, 6),
      amountWithTax: amount.toFixed(2),
    };
  });
  const declaredTotals = new Map<string, { actual: Prisma.Decimal; declared: string; label: string }>();
  for (const activeOrder of purchaseOrder.execution.purchaseOrders) {
    for (const item of activeOrder.items) {
      if (item.actualDeliveredQuantity == null) {
        blockingIssues.push(`采购单${activeOrder.sequenceNo}仍有商品未确认实际装柜数量。`);
        continue;
      }
      const candidate = candidateForItem(item, candidates, 0);
      if (!candidate || matchScore(item.productNameSnapshot, item.unitSnapshot, candidate) < 60) continue;
      const candidateIndex = candidates.indexOf(candidate);
      const customsQuantity = quantityForUnit(candidate, item.unitSnapshot);
      const key = `${candidateIndex}|${comparable(customsQuantity.unit || item.unitSnapshot)}`;
      const current = declaredTotals.get(key) || {
        actual: new Prisma.Decimal(0),
        declared: nonEmpty(customsQuantity.quantity),
        label: nonEmpty(candidate.productName || candidate.nameAndSpecification),
      };
      current.actual = current.actual.add(item.actualDeliveredQuantity);
      declaredTotals.set(key, current);
    }
  }
  for (const row of declaredTotals.values()) {
    try {
      if (!row.declared || !row.actual.eq(new Prisma.Decimal(row.declared.replace(/[,，\s]/g, "")))) {
        blockingIssues.push(`报关商品“${row.label}”的全部供应商实际装柜合计${decimalText(row.actual, 4)}与报关数量${row.declared || "未识别"}不一致。`);
      }
    } catch {
      blockingIssues.push(`报关商品“${row.label}”的数量“${row.declared || "未识别"}”无法核验。`);
    }
  }
  const calculatedTotal = items.reduce((sum, item) => sum.add(item.amountWithTax), new Prisma.Decimal(0)).toDecimalPlaces(2);
  if (!calculatedTotal.eq(purchaseOrder.settlement.baseAmount)) {
    throw codedError("实际装柜数量乘确认单价与采购结算货款基数不一致，请先修复结算数据。", 409, "SUPPLIER_TAX_CONTRACT_AMOUNT_MISMATCH");
  }
  const cnyAccount = purchaseOrder.execution.businessEntity.bankAccounts[0];
  const activeIndex = purchaseOrder.execution.purchaseOrders.findIndex((row) => row.id === purchaseOrder.id);
  const contractNo = `${purchaseOrder.execution.customerOrderNo}-${String(Math.max(0, activeIndex) + 1).padStart(2, "0")}`;
  return {
    contractNo,
    customerOrderNo: purchaseOrder.execution.customerOrderNo,
    orderId: cost.orderId,
    costId: cost.id,
    purchaseOrderId: purchaseOrder.id,
    purchaseOrderNo: purchaseOrder.poNo,
    customsDocumentId: customsDocument.id,
    customsDeclarationNo: purchaseOrder.execution.receivableOrder.customsDeclarationNo || "",
    supplierId: purchaseOrder.supplierId,
    supplierName: purchaseOrder.supplier.invoiceTitle || purchaseOrder.supplier.supplierName,
    supplierTaxNumber: purchaseOrder.supplier.taxNumber || "",
    supplierAddress: purchaseOrder.supplier.address || "",
    supplierPhone: purchaseOrder.supplier.phone || "",
    supplierBankName: purchaseOrder.supplier.bankName || "",
    supplierBankAccount: purchaseOrder.supplier.bankAccount || "",
    buyerBusinessEntityId: purchaseOrder.execution.businessEntityId,
    buyerName: purchaseOrder.execution.businessEntity.name,
    buyerTaxNumber: purchaseOrder.execution.businessEntity.taxNumber || "",
    buyerAddress: purchaseOrder.execution.businessEntity.address || "",
    buyerPhone: purchaseOrder.execution.businessEntity.contactPhone || "",
    buyerBankName: cnyAccount?.bankName || "",
    buyerBankAccount: cnyAccount?.accountNumber || purchaseOrder.execution.businessEntity.bankAccount || "",
    signingPlace: purchaseOrder.execution.businessEntity.address || "",
    signingDate: dateText(new Date()),
    latestDeliveryDate: dateText(purchaseOrder.confirmedSupplierDeliveryDate || purchaseOrder.requestedDeliveryDate),
    currency: purchaseOrder.purchaseCurrency,
    totalAmountWithTax: calculatedTotal.toFixed(2),
    items,
    customsSnapshot: candidates,
    warnings: [...new Set(warnings)],
    blockingIssues: [...new Set(blockingIssues)],
    generatedAt: new Date().toISOString(),
    ocrRequestIds: customs.requestIds,
  } satisfies SupplierTaxContractDraft;
}
