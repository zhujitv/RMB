import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import { recognizeTencentCustomsGoods } from "./tencent-customs-ocr-experiment";
import { codedError, nonEmpty } from "./shared-base-utils";
import { domesticContractIssues } from "./business-entity-domestic-bank";
import {
  correctedFactoryGoodsAmount,
  latestApprovedFactoryPrice,
} from "./factory-purchase-price-correction-contract";
import {
  customsQuantityForUnit,
  customsQuantityKey,
  customsUnitKey,
  hasCustomsUnit,
} from "./supplier-tax-contract-customs-match";
import {
  dateText,
  supplierTaxContractQuantityText,
  supplierTaxContractSigningDate,
  supplierTaxContractSupplierName,
} from "./supplier-tax-contract-values";
import type {
  SupplierTaxContractDraft,
  SupplierTaxContractItemDraft,
} from "./supplier-tax-contract-draft-types";

export type {
  SupplierTaxContractDraft,
  SupplierTaxContractItemDraft,
} from "./supplier-tax-contract-draft-types";

const ACTIVE_PURCHASE_ORDER_STATUSES = ["DISPATCHED", "ACCEPTED", "DELIVERY_PROPOSED"] as const;

function decimalText(value: Prisma.Decimal, places: number) {
  const fixed = value.toFixed(places);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

function matchScore(unit: string, quantity: unknown, candidate: Record<string, unknown>) {
  const units = Array.isArray(candidate.quantityUnits) ? candidate.quantityUnits as Array<Record<string, unknown>> : [];
  const unitKey = customsUnitKey(unit);
  const quantityKey = customsQuantityKey(quantity);
  let score = 0;
  if (units.some((row) => customsUnitKey(row.unit) === unitKey)) score += 30;
  if (quantityKey && units.some((row) => customsQuantityKey(row.quantity) === quantityKey && customsUnitKey(row.unit) === unitKey)) score += 120;
  else if (quantityKey && !unitKey && units.some((row) => customsQuantityKey(row.quantity) === quantityKey)) score += 20;
  return score;
}

export function candidateForSupplierTaxContractItem(
  item: { productNameSnapshot: string; unitSnapshot: string; actualDeliveredQuantity?: unknown },
  candidates: Array<Record<string, unknown>>,
  index: number,
) {
  const best = candidates
    .map((candidate) => ({
      candidate,
      score: matchScore(item.unitSnapshot, item.actualDeliveredQuantity, candidate),
    }))
    .sort((left, right) => right.score - left.score)[0];
  return best && best.score > 0 ? best.candidate : candidates[index] || null;
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
      priceCorrections: {
        where: { status: { in: ["PENDING", "APPROVED"] } },
        orderBy: [{ sequenceNo: "asc" }],
        select: {
          status: true,
          purchaseOrderItemId: true,
          oldUnitPrice: true,
          newUnitPrice: true,
          batchId: true,
          batchLineNo: true,
        },
      },
      items: { include: { supplierPrice: true }, orderBy: [{ lineNumber: "asc" }] },
      execution: {
        include: {
          businessEntity: true,
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
  if (purchaseOrder.priceCorrections.some((correction) => correction.status === "PENDING")) {
    throw codedError("采购单存在待审核的价格更正申请，请先完成审核再生成退税合同。", 409, "SUPPLIER_TAX_CONTRACT_PRICE_CORRECTION_PENDING");
  }
  const approvedPriceCorrections = purchaseOrder.priceCorrections.filter((correction) => correction.status === "APPROVED");
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
  let customs: Awaited<ReturnType<typeof recognizeTencentCustomsGoods>>;
  try {
    customs = await recognizeTencentCustomsGoods(await readR2Object(customsDocument.storageKey));
  } catch (error) {
    customs = {
      provider: "TENCENT_CLOUD",
      apiName: "RecognizeTableAccurateOCR",
      requestIds: [],
      totalPages: 0,
      items: [],
      warnings: [`OCR未能完整预填报关商品：${error instanceof Error ? error.message : "识别失败"}。请由人工补录并核对原件。`],
    };
  }
  const candidates = customs.items as Array<Record<string, unknown>>;
  const warnings = [...customs.warnings];
  const blockingIssues = domesticContractIssues(purchaseOrder.execution.businessEntity);
  const items = purchaseOrder.items.map((item, index): SupplierTaxContractItemDraft => {
    if (item.actualDeliveredQuantity == null) {
      throw codedError(`采购单第${item.lineNumber}行尚未确认实际装柜数量。`, 409, "ACTUAL_LOADED_QUANTITY_REQUIRED");
    }
    const price = latestApprovedFactoryPrice(
      approvedPriceCorrections,
      item.id,
      item.supplierPrice?.unitPrice ?? item.purchaseUnitPrice,
    );
    if (price == null) throw codedError(`采购单第${item.lineNumber}行缺少确认含税单价。`, 409, "SUPPLIER_UNIT_PRICE_REQUIRED");
    const quantity = new Prisma.Decimal(item.actualDeliveredQuantity);
    const candidate = candidateForSupplierTaxContractItem({ ...item, actualDeliveredQuantity: quantity }, candidates, index) || {};
    const customsQuantity = customsQuantityForUnit(candidate, item.unitSnapshot, quantity);
    const unitPrice = new Prisma.Decimal(price);
    const amount = quantity.mul(unitPrice).toDecimalPlaces(2);
    const productName = nonEmpty(candidate.productName || candidate.nameAndSpecification || item.productNameSnapshot) || `待人工补录品名${index + 1}`;
    const unit = nonEmpty(customsQuantity.unit || item.unitSnapshot);
    const declaredQuantity = nonEmpty(customsQuantity.quantity);
    if (matchScore(item.unitSnapshot, quantity, candidate) <= 0) {
      warnings.push(`采购第${item.lineNumber}行未按数量或单位命中报关商品，已生成可编辑预填行，请人工核查。`);
      blockingIssues.push(`采购第${item.lineNumber}行无法可靠匹配报关单商品，需人工保存确认后的商品信息。`);
    }
    if (!hasCustomsUnit(candidate, item.unitSnapshot)) {
      warnings.push(`采购第${item.lineNumber}行未在报关商品中找到单位“${item.unitSnapshot}”的数量组，已按采购单位生成，请人工核查。`);
    } else if (customsUnitKey(item.unitSnapshot) !== customsUnitKey(unit)) {
      warnings.push(`采购第${item.lineNumber}行单位“${item.unitSnapshot}”与报关单位“${unit}”不同，请人工确认换算依据。`);
    }
    return {
      lineNo: index + 1,
      rowId: item.id,
      purchaseOrderItemId: item.id,
      customsItemNo: nonEmpty(candidate.itemNo) || String(index + 1),
      customsCommodityCode: nonEmpty(candidate.commodityCode),
      productName,
      unit,
      quantity: supplierTaxContractQuantityText(quantity, declaredQuantity),
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
      const candidate = candidateForSupplierTaxContractItem(item, candidates, 0);
      if (!candidate || matchScore(item.unitSnapshot, item.actualDeliveredQuantity, candidate) <= 0) continue;
      const candidateIndex = candidates.indexOf(candidate);
      const customsQuantity = customsQuantityForUnit(candidate, item.unitSnapshot, item.actualDeliveredQuantity);
      const key = `${candidateIndex}|${customsUnitKey(customsQuantity.unit || item.unitSnapshot)}`;
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
  const correctedGoodsAmount = correctedFactoryGoodsAmount(
    purchaseOrder.settlement.baseAmount,
    approvedPriceCorrections,
    purchaseOrder.items,
  );
  if (!calculatedTotal.eq(correctedGoodsAmount)) {
    throw codedError("实际装柜数量乘确认单价与采购结算货款基数不一致，请先修复结算数据。", 409, "SUPPLIER_TAX_CONTRACT_AMOUNT_MISMATCH");
  }
  const contractNo = purchaseOrder.execution.customerOrderNo;
  const latestDeliveryDateValue = purchaseOrder.confirmedSupplierDeliveryDate || purchaseOrder.requestedDeliveryDate;
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
    supplierName: supplierTaxContractSupplierName(purchaseOrder.supplier),
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
    buyerBankName: purchaseOrder.execution.businessEntity.domesticBankName || "",
    buyerBankAccount: purchaseOrder.execution.businessEntity.domesticBankAccount || "",
    signingPlace: "浙江诸暨",
    signingDate: supplierTaxContractSigningDate(latestDeliveryDateValue),
    latestDeliveryDate: dateText(latestDeliveryDateValue),
    currency: purchaseOrder.purchaseCurrency,
    totalAmountWithTax: calculatedTotal.toFixed(2),
    items,
    ocrOriginalItems: items.map((item) => ({ ...item })),
    customsSnapshot: candidates,
    warnings: [...new Set(warnings)],
    blockingIssues: [...new Set(blockingIssues)],
    generatedAt: new Date().toISOString(),
    ocrRequestIds: customs.requestIds,
  } satisfies SupplierTaxContractDraft;
}
