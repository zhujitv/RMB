import type { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";
import { lockBusinessOrderForUpdate } from "./business-archive";

export type CommissionSettlementOrderLike = {
  commissionStatus?: string | null;
  commissionSettledAt?: Date | string | null;
  commissionSettlementRecords?: Array<{
    id?: string | null;
    status?: string | null;
    reversedAt?: Date | string | null;
  }> | null;
  _count?: { commissionSettlementRecords?: number | null } | null;
};

export function isCommissionSettled(order: CommissionSettlementOrderLike | null | undefined) {
  if (!order) return false;
  return ["已结算", "SETTLED"].includes(String(order.commissionStatus || "").trim())
    || Boolean(order.commissionSettledAt)
    || Boolean(order.commissionSettlementRecords?.some((record) => (
      String(record.status || "ACTIVE").trim() === "ACTIVE" && !record.reversedAt
    )))
    || Number(order._count?.commissionSettlementRecords || 0) > 0;
}

export function assertCommissionNotSettled(
  order: CommissionSettlementOrderLike | null | undefined,
  message = "该订单业务员提成已结算，不能再修改影响提成的数据；如需调整，请先走撤销结算流程。",
) {
  if (!isCommissionSettled(order)) return;
  throw codedError(message, 409, "COMMISSION_SETTLEMENT_LOCKED");
}

export async function assertCommissionOrderWritableInTransaction(
  tx: Prisma.TransactionClient,
  orderId: string,
  message?: string,
) {
  await lockBusinessOrderForUpdate(tx, orderId);
  const order = await tx.receivableOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      deletedAt: true,
      commissionStatus: true,
      commissionSettledAt: true,
      _count: {
        select: {
          commissionSettlementRecords: {
            where: { status: "ACTIVE", reversedAt: null },
          },
        },
      },
    },
  });
  if (!order || order.deletedAt) {
    throw codedError("关联订单不存在或已删除。", 404, "BUSINESS_ORDER_NOT_FOUND");
  }
  assertCommissionNotSettled(order, message);
  return order;
}
