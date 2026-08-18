import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { codedError, nonEmpty } from "./shared-base-utils";
import { FACTORY_SUPPLIER_COST_TYPES } from "./shared-cost-constants";
import type { SupplierTaxContractDraft, SupplierTaxContractItemDraft } from "./supplier-tax-contract-draft";
import {
  FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE,
  customsQuantity,
  dateText,
  decimalText,
  loadTransitionContext,
  nonNegativeMoney,
  parsedItems,
  positiveDecimal,
  recognizedCustoms,
  selectableCustomsItems,
  type TransitionInput,
} from "./supplier-transition-settlement-context";

export { FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE, previewFactoryPurchaseTransitionSettlement } from "./supplier-transition-settlement-context";

type PreparedTransition = {
  draft: SupplierTaxContractDraft;
  existingSettlementId?: string;
  settlementData?: {
    costId: string;
    orderId: string;
    supplierId: string;
    customsDocumentId: string;
    goodsAmountWithTax: Prisma.Decimal;
    increaseAmount: Prisma.Decimal;
    decreaseAmount: Prisma.Decimal;
    finalPayableAmount: Prisma.Decimal;
    currency: string;
    itemSnapshot: Prisma.InputJsonValue;
    customsSnapshot: Prisma.InputJsonValue;
    reason: string;
  };
};

export async function assertFactoryPurchaseTransitionAllocationAvailable(
  tx: Prisma.TransactionClient,
  input: { orderId: string; costId: string; itemSnapshot: Prisma.InputJsonValue },
) {
  const otherSettlements = await tx.factoryPurchaseTransitionSettlement.findMany({
    where: { orderId: input.orderId, costId: { not: input.costId } },
    select: { itemSnapshot: true },
  });
  const items = Array.isArray(input.itemSnapshot)
    ? input.itemSnapshot as Array<Record<string, unknown>>
    : [];
  for (const item of items) {
    const customsItemIndex = Number(item.customsItemIndex);
    const allocated = otherSettlements.reduce((sum, settlement) => {
      const rows = Array.isArray(settlement.itemSnapshot)
        ? settlement.itemSnapshot as Array<Record<string, unknown>>
        : [];
      return rows
        .filter((row) => Number(row.customsItemIndex) === customsItemIndex)
        .reduce((subtotal, row) => subtotal.add(nonEmpty(row.quantity) || 0), sum);
    }, new Prisma.Decimal(nonEmpty(item.quantity) || 0));
    const declaredText = nonEmpty(item.declaredQuantity).replace(/[,，\s]/g, "");
    if (/^\d+(?:\.\d+)?$/.test(declaredText) && allocated.gt(new Prisma.Decimal(declaredText))) {
      throw codedError(
        `报关商品“${nonEmpty(item.productName)}”已分配给工厂的数量超过报关数量。`,
        409,
        "FACTORY_TRANSITION_ORDER_QUANTITY_EXCEEDS_CUSTOMS",
      );
    }
  }
}

export async function prepareFactoryPurchaseTransitionSettlement(costId: string, input: TransitionInput): Promise<PreparedTransition> {
  const { cost, customsDocument } = await loadTransitionContext(costId);
  const supplier = cost.supplier!;
  const supplierId = cost.supplierId!;
  const customs = await recognizedCustoms(customsDocument.storageKey);
  const candidates = customs.items as Array<Record<string, unknown>>;
  let storedItems: Array<Record<string, unknown>>;
  let increaseAmount: Prisma.Decimal;
  let decreaseAmount: Prisma.Decimal;
  let reason: string;
  let existingSettlementId: string | undefined;

  if (cost.transitionSettlement) {
    if (cost.transitionSettlement.customsDocumentId !== customsDocument.id) {
      throw codedError("报关单已更新，已确认的过渡结算不能自动改写，请联系管理员处理。", 409, "FACTORY_TRANSITION_CUSTOMS_CHANGED");
    }
    storedItems = cost.transitionSettlement.itemSnapshot as Array<Record<string, unknown>>;
    increaseAmount = cost.transitionSettlement.increaseAmount;
    decreaseAmount = cost.transitionSettlement.decreaseAmount;
    reason = cost.transitionSettlement.reason;
    existingSettlementId = cost.transitionSettlement.id;
  } else {
    if (input.confirmed !== true && input.confirmed !== "true") {
      throw codedError("请确认该订单为已发货报关的历史过渡订单。", 400, "FACTORY_TRANSITION_CONFIRM_REQUIRED");
    }
    reason = nonEmpty(input.reason).slice(0, 1000);
    if (reason.length < 5) throw codedError("请填写至少5个字的过渡结算原因。", 400, "FACTORY_TRANSITION_REASON_REQUIRED");
    increaseAmount = nonNegativeMoney(input.increaseAmount, "增加费用");
    decreaseAmount = nonNegativeMoney(input.decreaseAmount, "扣减金额");
    const seen = new Set<number>();
    const preparedItems = parsedItems(input.items).map((raw, index) => {
      const customsItemIndex = Number(raw.customsItemIndex);
      if (!Number.isInteger(customsItemIndex) || customsItemIndex < 0 || customsItemIndex >= candidates.length || seen.has(customsItemIndex)) {
        throw codedError(`第${index + 1}行报关商品引用无效或重复。`, 400, "FACTORY_TRANSITION_CUSTOMS_ITEM_INVALID");
      }
      seen.add(customsItemIndex);
      const candidate = candidates[customsItemIndex];
      const declared = customsQuantity(candidate);
      const productName = nonEmpty(raw.productName).slice(0, 200);
      const unit = nonEmpty(raw.unit).slice(0, 40);
      if (!productName || !unit) throw codedError(`第${index + 1}行品名和单位不能为空。`, 400, "FACTORY_TRANSITION_ITEM_TEXT_REQUIRED");
      const quantity = positiveDecimal(raw.quantity, `第${index + 1}行数量`, 4);
      const declaredText = nonEmpty(declared.quantity).replace(/[,，\s]/g, "");
      if (declaredText && /^\d+(?:\.\d+)?$/.test(declaredText) && quantity.gt(new Prisma.Decimal(declaredText))) {
        throw codedError(`第${index + 1}行供应商数量不能超过报关数量${declaredText}。`, 409, "FACTORY_TRANSITION_QUANTITY_EXCEEDS_CUSTOMS");
      }
      return {
        customsItemIndex,
        productName,
        unit,
        quantity,
        declaredQuantity: nonEmpty(declared.quantity),
      };
    });
    const goodsTarget = cost.amount.sub(increaseAmount).add(decreaseAmount).toDecimalPlaces(2);
    if (!goodsTarget.gt(0)) throw codedError("已登记工厂成本扣除费用调整后必须大于0。", 409, "FACTORY_TRANSITION_GOODS_AMOUNT_INVALID");
    const totalQuantity = preparedItems.reduce((sum, item) => sum.add(item.quantity), new Prisma.Decimal(0));
    let allocatedAmount = new Prisma.Decimal(0);
    storedItems = preparedItems.map((item, index) => {
      const amount = index === preparedItems.length - 1
        ? goodsTarget.sub(allocatedAmount)
        : goodsTarget.mul(item.quantity).div(totalQuantity).toDecimalPlaces(2);
      allocatedAmount = allocatedAmount.add(amount);
      return {
        customsItemIndex: item.customsItemIndex,
        customsItemNo: String(index + 1),
        customsCommodityCode: "",
        productName: item.productName,
        unit: item.unit,
        quantity: decimalText(item.quantity, 4),
        declaredQuantity: item.declaredQuantity,
        unitPriceWithTax: decimalText(amount.div(item.quantity).toDecimalPlaces(6), 6),
        amountWithTax: amount.toFixed(2),
      };
    });
  }

  const items: SupplierTaxContractItemDraft[] = storedItems.map((item, index) => ({
    lineNo: index + 1,
    purchaseOrderItemId: `transition:${cost.id}:${item.customsItemIndex}`,
    customsItemNo: nonEmpty(item.customsItemNo) || String(index + 1),
    customsCommodityCode: nonEmpty(item.customsCommodityCode),
    productName: nonEmpty(item.productName),
    unit: nonEmpty(item.unit),
    quantity: nonEmpty(item.quantity),
    declaredQuantity: nonEmpty(item.declaredQuantity),
    unitPriceWithTax: nonEmpty(item.unitPriceWithTax),
    amountWithTax: nonEmpty(item.amountWithTax),
  }));
  const goodsAmount = items.reduce((sum, item) => sum.add(item.amountWithTax), new Prisma.Decimal(0)).toDecimalPlaces(2);
  const finalPayable = goodsAmount.add(increaseAmount).sub(decreaseAmount).toDecimalPlaces(2);
  if (!finalPayable.eq(cost.amount)) {
    throw codedError(
      `商品含税金额${goodsAmount.toFixed(2)} + 增加费用${increaseAmount.toFixed(2)} - 扣减${decreaseAmount.toFixed(2)} = ${finalPayable.toFixed(2)}，与现有成本${cost.amount.toFixed(2)}不一致。`,
      409,
      "FACTORY_TRANSITION_AMOUNT_MISMATCH",
    );
  }
  if (cost.currency !== "CNY") {
    throw codedError("过渡退税合同目前只支持人民币工厂成本。", 409, "FACTORY_TRANSITION_CNY_REQUIRED");
  }
  if (!cost.exchangeRate.eq(1) || !cost.amountCny.eq(cost.amount)) {
    throw codedError("人民币过渡成本的汇率必须为1，且折人民币金额必须与原金额一致。", 409, "FACTORY_TRANSITION_CNY_AMOUNT_INVALID");
  }
  const otherSettlements = await prisma.factoryPurchaseTransitionSettlement.findMany({
    where: { orderId: cost.orderId, costId: { not: cost.id } },
    select: { itemSnapshot: true },
  });
  const warnings = [...customs.warnings, "本合同由已发货报关的历史过渡订单结算凭证生成，未补造历史采购、生产和下发记录。"];
  for (const item of storedItems) {
    const index = Number(item.customsItemIndex);
    const total = otherSettlements.reduce((sum, settlement) => {
      const rows = Array.isArray(settlement.itemSnapshot) ? settlement.itemSnapshot as Array<Record<string, unknown>> : [];
      return rows.filter((row) => Number(row.customsItemIndex) === index)
        .reduce((subtotal, row) => subtotal.add(nonEmpty(row.quantity) || 0), sum);
    }, new Prisma.Decimal(nonEmpty(item.quantity) || 0));
    const declaredText = nonEmpty(item.declaredQuantity).replace(/[,，\s]/g, "");
    if (declaredText && /^\d+(?:\.\d+)?$/.test(declaredText)) {
      const declared = new Prisma.Decimal(declaredText);
      if (total.gt(declared)) throw codedError(`报关商品“${nonEmpty(item.productName)}”已分配给工厂的数量超过报关数量。`, 409, "FACTORY_TRANSITION_ORDER_QUANTITY_EXCEEDS_CUSTOMS");
      if (total.lt(declared)) warnings.push(`报关商品“${nonEmpty(item.productName)}”当前累计分配${decimalText(total, 4)}，报关数量${decimalText(declared, 4)}，剩余数量可继续分配给其它工厂成本。`);
    }
  }
  const factoryCosts = await prisma.orderCost.findMany({
    where: { orderId: cost.orderId, deletedAt: null, status: "ACTIVE", costType: { in: FACTORY_SUPPLIER_COST_TYPES } },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const sequence = Math.max(0, factoryCosts.findIndex((row) => row.id === cost.id)) + 1;
  const entity = cost.order.businessEntity!;
  const cnyAccount = entity.bankAccounts[0];
  const relevantCustomsSnapshot = selectableCustomsItems(candidates);
  const draft: SupplierTaxContractDraft = {
    contractNo: `${cost.order.orderNo}-T${String(sequence).padStart(2, "0")}`,
    customerOrderNo: cost.order.orderNo,
    orderId: cost.orderId,
    costId: cost.id,
    purchaseOrderId: "",
    purchaseOrderNo: `过渡结算-${cost.order.orderNo}`,
    customsDocumentId: customsDocument.id,
    customsDeclarationNo: cost.order.customsDeclarationNo || "",
    supplierId,
    supplierName: supplier.invoiceTitle || supplier.supplierName,
    supplierTaxNumber: supplier.taxNumber || "",
    supplierAddress: supplier.address || "",
    supplierPhone: supplier.phone || "",
    supplierBankName: supplier.bankName || "",
    supplierBankAccount: supplier.bankAccount || "",
    buyerBusinessEntityId: entity.id,
    buyerName: entity.name,
    buyerTaxNumber: entity.taxNumber || "",
    buyerAddress: entity.address || "",
    buyerPhone: entity.contactPhone || "",
    buyerBankName: cnyAccount?.bankName || "",
    buyerBankAccount: cnyAccount?.accountNumber || entity.bankAccount || "",
    signingPlace: entity.address || "",
    signingDate: dateText(new Date()),
    latestDeliveryDate: dateText(cost.order.actualShipmentDate || cost.order.customsDeclarationDate || new Date()),
    currency: cost.currency,
    totalAmountWithTax: goodsAmount.toFixed(2),
    items,
    customsSnapshot: relevantCustomsSnapshot,
    warnings: [...new Set(warnings)],
    blockingIssues: [],
    generatedAt: new Date().toISOString(),
    ocrRequestIds: customs.requestIds,
    sourceType: FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE,
    transitionSettlementId: existingSettlementId,
  };
  return {
    draft,
    existingSettlementId,
    ...(!existingSettlementId ? {
      settlementData: {
        costId: cost.id,
        orderId: cost.orderId,
        supplierId,
        customsDocumentId: customsDocument.id,
        goodsAmountWithTax: goodsAmount,
        increaseAmount,
        decreaseAmount,
        finalPayableAmount: finalPayable,
        currency: cost.currency,
        itemSnapshot: storedItems as Prisma.InputJsonValue,
        customsSnapshot: relevantCustomsSnapshot as Prisma.InputJsonValue,
        reason,
      },
    } : {}),
  };
}
