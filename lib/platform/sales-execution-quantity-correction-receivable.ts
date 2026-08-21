import { Prisma } from "../generated/prisma/client.js";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import { domesticShipmentDateFromItems } from "./domestic-logistics-shipment-sync";
import { codedError, writeAudit } from "./shared";

type AuditRequest = Parameters<typeof writeAudit>[0];

type LinkedExecution = {
  receivableOrder?: { id: string; deletedAt?: Date | null } | null;
};

const BLOCKING_PAYMENT_STATUSES = ["待确认", "已到账"];

export type QuantityCorrectionReceivable = {
  id: string;
  exchangeRate: Prisma.Decimal;
  updatedById: string;
  resetShipmentRegistration: boolean;
  previousState: {
    status: string;
    receivableAmount: Prisma.Decimal;
    receivableAmountCny: Prisma.Decimal;
    estimatedReceivableAmount: Prisma.Decimal;
    estimatedReceivableAmountCny: Prisma.Decimal;
    finalReceivableAmount: Prisma.Decimal;
    finalReceivableAmountCny: Prisma.Decimal;
    actualShipmentDate: Date | null;
    actualShipmentAmount: Prisma.Decimal | null;
    actualShipmentAmountCny: Prisma.Decimal | null;
  };
};

type ShipmentEvidenceOrder = {
  blNo?: unknown;
  blDate?: unknown;
  customsDeclarationNo?: unknown;
  customsDeclarationDate?: unknown;
  domesticLogisticsInfos?: Array<{
    transportType?: unknown;
    departureDate?: unknown;
    expressTrackingNo?: unknown;
    transportItems?: Array<{ departureDate?: unknown }>;
  }>;
};

export function independentShipmentEvidence(order: ShipmentEvidenceOrder) {
  const evidence: string[] = [];
  if (String(order.blNo || "").trim() || order.blDate) evidence.push("提单信息");
  if (String(order.customsDeclarationNo || "").trim() || order.customsDeclarationDate) evidence.push("报关信息");
  if ((order.domesticLogisticsInfos || []).some((info) => String(info.expressTrackingNo || "").trim())) {
    evidence.push("快递单号");
  }
  const domesticDeparture = (order.domesticLogisticsInfos || []).some((info) => {
    const transportType = String(info.transportType || "");
    if (!["TRUCK", "MULTIMODAL"].includes(transportType)) return false;
    return Boolean(
      domesticShipmentDateFromItems(transportType, info.transportItems)
      || info.departureDate,
    );
  });
  if (domesticDeparture) evidence.push("国内物流起运记录");
  return evidence;
}

export function shipmentRegistrationDecision(
  status: unknown,
  actualShipmentDate: unknown,
  actualShipmentAmount: unknown,
  actualShipmentAmountCny: unknown,
) {
  const registered = Boolean(actualShipmentDate)
    || actualShipmentAmount != null
    || actualShipmentAmountCny != null;
  return {
    registered,
    resetAllowed: registered && String(status || "").trim() === "草稿",
  };
}

export async function loadQuantityCorrectionReceivable(
  tx: Prisma.TransactionClient,
  execution: LinkedExecution,
  actorId: string,
) {
  const linked = execution.receivableOrder;
  if (!linked || linked.deletedAt) return null;
  await assertBusinessOrderWritableInTransaction(
    tx,
    linked.id,
    "关联应收订单已提交退税归档，不能更正已下发数量。",
  );
  const order = await tx.receivableOrder.findUnique({
    where: { id: linked.id },
    select: {
      id: true,
      status: true,
      exchangeRate: true,
      receivableAmount: true,
      receivableAmountCny: true,
      estimatedReceivableAmount: true,
      estimatedReceivableAmountCny: true,
      finalReceivableAmount: true,
      finalReceivableAmountCny: true,
      actualShipmentDate: true,
      actualShipmentAmount: true,
      actualShipmentAmountCny: true,
      blNo: true,
      blDate: true,
      customsDeclarationNo: true,
      customsDeclarationDate: true,
      domesticLogisticsInfos: {
        where: { deletedAt: null },
        select: {
          transportType: true,
          departureDate: true,
          expressTrackingNo: true,
          transportItems: { select: { departureDate: true } },
        },
      },
      payments: {
        where: { deletedAt: null, status: { in: BLOCKING_PAYMENT_STATUSES } },
        select: { id: true },
      },
    },
  });
  if (!order) {
    throw codedError("关联应收订单不存在，请联系管理员处理", 404, "SALES_QUANTITY_CORRECTION_RECEIVABLE_MISSING");
  }
  const shipment = shipmentRegistrationDecision(
    order.status,
    order.actualShipmentDate,
    order.actualShipmentAmount,
    order.actualShipmentAmountCny,
  );
  const independentEvidence = independentShipmentEvidence(order);
  if (independentEvidence.length) {
    throw codedError(
      `关联应收订单已有${independentEvidence.join("、")}，请先在对应模块核对或撤销后再更正数量`,
      409,
      "SALES_QUANTITY_CORRECTION_RECEIVABLE_SHIPPING_EVIDENCE",
    );
  }
  if (shipment.registered && !shipment.resetAllowed) {
    throw codedError(
      "关联应收订单已登记实际发货；如该登记有误，请先将订单恢复为草稿，再更正已下发数量",
      409,
      "SALES_QUANTITY_CORRECTION_RECEIVABLE_SHIPPED",
    );
  }
  if (order.payments.length) {
    throw codedError("关联应收订单已有收款记录，不能更正已下发数量", 409, "SALES_QUANTITY_CORRECTION_RECEIVABLE_PAYMENT_EXISTS");
  }
  return {
    id: order.id,
    exchangeRate: order.exchangeRate,
    updatedById: actorId,
    resetShipmentRegistration: shipment.resetAllowed,
    previousState: {
      status: order.status,
      receivableAmount: order.receivableAmount,
      receivableAmountCny: order.receivableAmountCny,
      estimatedReceivableAmount: order.estimatedReceivableAmount,
      estimatedReceivableAmountCny: order.estimatedReceivableAmountCny,
      finalReceivableAmount: order.finalReceivableAmount,
      finalReceivableAmountCny: order.finalReceivableAmountCny,
      actualShipmentDate: order.actualShipmentDate,
      actualShipmentAmount: order.actualShipmentAmount,
      actualShipmentAmountCny: order.actualShipmentAmountCny,
    },
  } satisfies QuantityCorrectionReceivable;
}

export async function syncQuantityCorrectionReceivable(
  tx: Prisma.TransactionClient,
  request: AuditRequest,
  actorId: string,
  receivable: QuantityCorrectionReceivable,
  newSalesTotal: Prisma.Decimal,
  reason: string,
) {
  const amountCny = newSalesTotal.mul(receivable.exchangeRate).toDecimalPlaces(2);
  const updated = await tx.receivableOrder.update({
    where: { id: receivable.id },
    data: {
      receivableAmount: newSalesTotal,
      receivableAmountCny: amountCny,
      estimatedReceivableAmount: newSalesTotal,
      estimatedReceivableAmountCny: amountCny,
      finalReceivableAmount: newSalesTotal,
      finalReceivableAmountCny: amountCny,
      ...(receivable.resetShipmentRegistration ? {
        actualShipmentDate: null,
        actualShipmentAmount: null,
        actualShipmentAmountCny: null,
      } : {}),
      updatedById: receivable.updatedById,
    },
    select: {
      status: true,
      receivableAmount: true,
      receivableAmountCny: true,
      estimatedReceivableAmount: true,
      estimatedReceivableAmountCny: true,
      finalReceivableAmount: true,
      finalReceivableAmountCny: true,
      actualShipmentDate: true,
      actualShipmentAmount: true,
      actualShipmentAmountCny: true,
    },
  });
  await writeAudit(
    request,
    { id: actorId },
    receivable.resetShipmentRegistration
      ? "数量更正时撤销草稿应收订单发货登记"
      : "数量更正时同步应收订单金额",
    "receivable_orders",
    receivable.id,
    receivable.previousState,
    {
      ...updated,
      shipmentRegistrationReset: receivable.resetShipmentRegistration,
      reason,
    },
    tx,
  );
}
