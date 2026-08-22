import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { activeSupplierStatuses } from "./factory-purchase-order-execution-shared";
import { salesExecutionAccessWhere, type SalesExecutionActor } from "./sales-execution-access";

export type PriceCorrectionAuditRequest = Parameters<typeof writeAudit>[0];

const MAX_FACTORY_MONEY = new Prisma.Decimal("9999999999999999.99");

export function factoryCorrectionUnitPrice(value: unknown) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(text)) {
    throw codedError("采购单价格式错误，整数最多十二位、小数最多六位", 400, "FACTORY_PRICE_CORRECTION_UNIT_PRICE_INVALID");
  }
  const amount = new Prisma.Decimal(text);
  if (amount.lte(0)) {
    throw codedError("采购单价必须大于 0", 400, "FACTORY_PRICE_CORRECTION_UNIT_PRICE_INVALID");
  }
  return amount;
}

export function assertFactoryMoneyAmount(value: Prisma.Decimal, label: string) {
  if (!value.isFinite() || value.abs().gt(MAX_FACTORY_MONEY)) {
    throw codedError(`${label}超过系统可保存的金额上限`, 400, "FACTORY_PRICE_CORRECTION_AMOUNT_OVERFLOW");
  }
  return value;
}

export function factoryCorrectionAmounts(
  quantity: Prisma.Decimal,
  oldUnitPrice: Prisma.Decimal,
  newUnitPrice: Prisma.Decimal,
) {
  const oldAmount = assertFactoryMoneyAmount(quantity.mul(oldUnitPrice).toDecimalPlaces(2), "原采购金额");
  const newAmount = assertFactoryMoneyAmount(quantity.mul(newUnitPrice).toDecimalPlaces(2), "更正后采购金额");
  const deltaAmount = assertFactoryMoneyAmount(newAmount.sub(oldAmount).toDecimalPlaces(2), "采购价格更正差额");
  if (deltaAmount.eq(0)) {
    throw codedError("本次价格更正不会产生金额差额", 400, "FACTORY_PRICE_CORRECTION_NO_AMOUNT_CHANGE");
  }
  return { oldAmount, newAmount, deltaAmount };
}

export function assertPriceCorrectionRequestReplay(existing: {
  purchaseOrderItemId: string;
  newUnitPrice: Prisma.Decimal;
  reason: string;
}, input: {
  purchaseOrderItemId: string;
  newUnitPrice: Prisma.Decimal;
  reason: string;
}) {
  if (existing.purchaseOrderItemId !== input.purchaseOrderItemId
    || !existing.newUnitPrice.eq(input.newUnitPrice)
    || existing.reason !== input.reason) {
    throw codedError(
      "同一提交凭证对应的采购价格更正内容不一致，请刷新后重新提交",
      409,
      "FACTORY_PRICE_CORRECTION_IDEMPOTENCY_CONFLICT",
    );
  }
  return existing;
}

export function terminalPriceCorrectionReviewReplay(
  correction: { status: string },
  action: "APPROVE" | "REJECT",
) {
  if (correction.status === "PENDING") return null;
  const expectedStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";
  if (correction.status === expectedStatus) return correction;
  throw codedError(
    `该申请已经${correction.status === "APPROVED" ? "审核通过" : "驳回"}，不能执行相反的审核动作`,
    409,
    "FACTORY_PRICE_CORRECTION_REVIEW_CONFLICT",
  );
}

type SettlementCorrectionSnapshot = {
  revision: number;
  increaseAmount: Prisma.Decimal;
  decreaseAmount: Prisma.Decimal;
  finalPayableAmount: Prisma.Decimal;
  paidAmountAtSettlement: Prisma.Decimal;
  status: "PENDING_PAYMENT" | "SETTLED" | "PENDING_REFUND";
  settledAt: Date | null;
  settledById: string | null;
};

export function factoryPriceCorrectionSettlementSnapshot(
  before: SettlementCorrectionSnapshot,
  after: SettlementCorrectionSnapshot,
) {
  return {
    settlementFinalPayableBefore: before.finalPayableAmount,
    settlementFinalPayableAfter: after.finalPayableAmount,
    settlementStatusBefore: before.status,
    settlementStatusAfter: after.status,
    settlementRevisionBefore: before.revision,
    settlementRevisionAfter: after.revision,
    settlementIncreaseBefore: before.increaseAmount,
    settlementIncreaseAfter: after.increaseAmount,
    settlementDecreaseBefore: before.decreaseAmount,
    settlementDecreaseAfter: after.decreaseAmount,
    settlementPaidBefore: before.paidAmountAtSettlement,
    settlementPaidAfter: after.paidAmountAtSettlement,
    settlementSettledAtBefore: before.settledAt,
    settlementSettledAtAfter: after.settledAt,
    settlementSettledByBeforeId: before.settledById,
    settlementSettledByAfterId: after.settledById,
  };
}

export function formatCorrectionPrice(value: Prisma.Decimal) {
  return value.toDecimalPlaces(6).toString();
}

export function formatCorrectionAmount(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2).toString();
}

export async function loadPurchaseOrderWithPriceCorrections(
  tx: Prisma.TransactionClient,
  executionId: string,
  purchaseOrderId: string,
  actor: SalesExecutionActor,
) {
  const purchaseOrder = await tx.factoryPurchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      executionId,
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    include: {
      items: { orderBy: [{ lineNumber: "asc" }], include: { supplierPrice: true } },
      payments: true,
      adjustments: true,
      settlement: true,
      priceCorrections: { orderBy: [{ sequenceNo: "asc" }] },
      execution: { select: { receivableOrder: { select: { id: true } } } },
    },
  });
  if (!purchaseOrder) {
    throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  }
  return purchaseOrder;
}

export type PriceCorrectionPurchaseOrder = Awaited<ReturnType<typeof loadPurchaseOrderWithPriceCorrections>>;
export type PriceCorrectionPurchaseOrderItem = PriceCorrectionPurchaseOrder["items"][number];

export function assertPriceCorrectionAllowed(purchaseOrder: PriceCorrectionPurchaseOrder) {
  if (!(activeSupplierStatuses as readonly string[]).includes(purchaseOrder.status)) {
    throw codedError("只有已确认的采购单可以申请价格更正", 409, "FACTORY_PRICE_CORRECTION_PURCHASE_ORDER_NOT_ACTIVE");
  }
}

export function currentApprovedUnitPrice(
  purchaseOrder: PriceCorrectionPurchaseOrder,
  item: PriceCorrectionPurchaseOrderItem,
) {
  const correction = purchaseOrder.priceCorrections
    .filter((candidate) => candidate.purchaseOrderItemId === item.id && candidate.status === "APPROVED")
    .at(-1);
  return {
    unitPrice: correction?.newUnitPrice ?? item.supplierPrice?.unitPrice ?? item.purchaseUnitPrice,
    sourceType: correction ? "APPROVED_PRICE_CORRECTION" : item.supplierPrice ? "SUPPLIER_CONFIRMED" : "PURCHASE_ORDER",
  };
}

export function correctionQuantitySnapshot(
  purchaseOrder: PriceCorrectionPurchaseOrder,
  item: PriceCorrectionPurchaseOrderItem,
) {
  if (purchaseOrder.settlement && item.actualDeliveredQuantity === null) {
    throw codedError(
      "该采购单已完成最终应付确认，必须先补齐该产品的实际交付数量",
      409,
      "FACTORY_PRICE_CORRECTION_ACTUAL_DELIVERY_REQUIRED",
    );
  }
  const quantity = item.actualDeliveredQuantity ?? item.allocatedQuantity;
  if (!quantity.gt(0)) {
    throw codedError("采购价格更正数量必须大于 0", 409, "FACTORY_PRICE_CORRECTION_QUANTITY_INVALID");
  }
  return quantity;
}

export function confirmedPriceCorrectionAdjustmentTotals(adjustments: Array<{
  status: string;
  kind: string;
  direction: string;
  amount: Prisma.Decimal;
}>) {
  return adjustments.reduce((totals, adjustment) => {
    if (adjustment.status !== "CONFIRMED" || adjustment.kind === "DELAY_PENALTY") return totals;
    if (adjustment.direction === "INCREASE") totals.increase = totals.increase.add(adjustment.amount);
    if (adjustment.direction === "DECREASE") totals.decrease = totals.decrease.add(adjustment.amount);
    return totals;
  }, { increase: new Prisma.Decimal(0), decrease: new Prisma.Decimal(0) });
}
