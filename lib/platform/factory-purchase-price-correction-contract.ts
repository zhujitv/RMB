import { Prisma } from "../generated/prisma/client.js";
import { codedError, nonEmpty } from "./shared-base-utils";
import type { SalesExecutionClient } from "./sales-execution-access";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import { supplierDocumentRequestCostOccupancy } from "./supplier-document-request-availability";

type ApprovedCorrection = {
  purchaseOrderItemId: string;
  oldUnitPrice: Prisma.Decimal;
  newUnitPrice: Prisma.Decimal;
};

type DeliveredItem = {
  id: string;
  actualDeliveredQuantity: Prisma.Decimal | null;
};

export function latestApprovedFactoryPrice(
  corrections: ApprovedCorrection[],
  itemId: string,
  fallback: Prisma.Decimal | null,
) {
  return corrections.filter((row) => row.purchaseOrderItemId === itemId).at(-1)?.newUnitPrice ?? fallback;
}

export function correctedFactoryGoodsAmount(
  baseAmount: Prisma.Decimal,
  corrections: ApprovedCorrection[],
  items: DeliveredItem[],
) {
  const quantities = new Map(items.map((item) => [item.id, item.actualDeliveredQuantity]));
  return corrections.reduce((amount, correction) => {
    const quantity = quantities.get(correction.purchaseOrderItemId);
    if (quantity == null) {
      throw codedError(
        "采购价格更正缺少对应产品的实际交付数量，不能生成或审核退税合同。",
        409,
        "SUPPLIER_TAX_CONTRACT_CORRECTION_QUANTITY_REQUIRED",
      );
    }
    const oldAmount = quantity.mul(correction.oldUnitPrice).toDecimalPlaces(2);
    const newAmount = quantity.mul(correction.newUnitPrice).toDecimalPlaces(2);
    return amount.add(newAmount.sub(oldAmount));
  }, baseAmount).toDecimalPlaces(2);
}

async function currentContractFinancials(client: SalesExecutionClient, purchaseOrderId: string) {
  const purchaseOrder = await client.factoryPurchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      settlement: { select: { baseAmount: true } },
      items: {
        select: {
          id: true,
          actualDeliveredQuantity: true,
          purchaseUnitPrice: true,
          supplierPrice: { select: { unitPrice: true } },
        },
        orderBy: [{ lineNumber: "asc" }],
      },
      priceCorrections: {
        where: { status: { in: ["PENDING", "APPROVED"] } },
        select: {
          status: true,
          purchaseOrderItemId: true,
          oldUnitPrice: true,
          newUnitPrice: true,
        },
        orderBy: [{ sequenceNo: "asc" }],
      },
    },
  });
  if (!purchaseOrder?.settlement) {
    throw codedError("采购单尚未完成最终结算，不能生成或审核退税合同。", 409, "SUPPLIER_TAX_CONTRACT_SETTLEMENT_REQUIRED");
  }
  if (purchaseOrder.priceCorrections.some((correction) => correction.status === "PENDING")) {
    throw codedError(
      "采购单存在待审核的价格更正申请，请先完成审核再生成或审核退税合同。",
      409,
      "SUPPLIER_TAX_CONTRACT_PRICE_CORRECTION_PENDING",
    );
  }
  return {
    ...purchaseOrder,
    settlement: purchaseOrder.settlement,
    priceCorrections: purchaseOrder.priceCorrections.filter((correction) => correction.status === "APPROVED"),
  };
}

export async function assertSupplierTaxContractFinancialsCurrent(
  client: SalesExecutionClient,
  draft: SupplierTaxContractDraft,
) {
  const purchaseOrder = await currentContractFinancials(client, draft.purchaseOrderId);
  const draftItems = new Map(draft.items.map((item) => [item.purchaseOrderItemId, item]));
  if (draftItems.size !== purchaseOrder.items.length || draftItems.size !== draft.items.length) {
    throw codedError("采购商品行已变化，请删除当前草稿并重新生成合同。", 409, "SUPPLIER_TAX_CONTRACT_PRICE_CHANGED");
  }
  for (const item of purchaseOrder.items) {
    const draftItem = draftItems.get(item.id);
    const expectedPrice = latestApprovedFactoryPrice(
      purchaseOrder.priceCorrections,
      item.id,
      item.supplierPrice?.unitPrice ?? item.purchaseUnitPrice,
    );
    if (!draftItem || !expectedPrice || !new Prisma.Decimal(draftItem.unitPriceWithTax).eq(expectedPrice)) {
      throw codedError("采购单价已发生更正，请删除当前草稿并按最新单价重新生成合同。", 409, "SUPPLIER_TAX_CONTRACT_PRICE_CHANGED");
    }
  }
  const expectedTotal = correctedFactoryGoodsAmount(
    purchaseOrder.settlement.baseAmount,
    purchaseOrder.priceCorrections,
    purchaseOrder.items,
  );
  const itemTotal = draft.items.reduce(
    (sum, item) => sum.add(new Prisma.Decimal(item.amountWithTax)),
    new Prisma.Decimal(0),
  ).toDecimalPlaces(2);
  if (!new Prisma.Decimal(draft.totalAmountWithTax).eq(expectedTotal) || !itemTotal.eq(expectedTotal)) {
    throw codedError("采购货款基数已发生更正，请删除当前草稿并重新生成合同。", 409, "SUPPLIER_TAX_CONTRACT_SETTLEMENT_CHANGED");
  }
  return expectedTotal;
}

export async function assertPriceCorrectionSupplierDocumentsWithdrawn(
  client: SalesExecutionClient,
  purchaseOrderId: string,
) {
  const cost = await client.orderCost.findFirst({
    where: {
      sourceType: "FACTORY_PURCHASE_SETTLEMENT",
      sourceId: purchaseOrderId,
      deletedAt: null,
      status: { not: "VOID" },
    },
    select: { id: true, orderId: true, supplierId: true },
  });
  if (!cost) return;
  const occupancy = await supplierDocumentRequestCostOccupancy(cost, client);
  if (!occupancy.occupied) return;
  const reference = nonEmpty(occupancy.sourceId) || cost.id;
  throw codedError(
    `该采购单已有有效的退税合同/发票资料回传任务（${reference}）。请先在“资料回传”撤回并删除该任务，使旧合同和发票OCR结果作废后，再审核采购价格更正。`,
    409,
    "FACTORY_PRICE_CORRECTION_SUPPLIER_DOCUMENTS_ACTIVE",
  );
}
