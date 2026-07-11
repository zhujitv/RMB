import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-errors";

export const BUSINESS_ARCHIVE_TAX_STATUSES = ["SUBMITTED", "REFUND_RECEIVED", "COMPLETED", "ARCHIVED"];

export type BusinessArchiveScope = "current" | "archive" | "all";

export type BusinessArchiveOrderLike = {
  taxArchived?: boolean | null;
  taxRefundStatus?: string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxSubmittedAt?: Date | string | null;
};

export function businessArchiveScope(value: unknown): BusinessArchiveScope {
  const scope = String(value || "").trim();
  return scope === "archive" || scope === "all" ? scope : "current";
}

export function isBusinessArchived(order: BusinessArchiveOrderLike | null | undefined) {
  if (!order) return false;
  return Boolean(
    order.taxArchived
    || order.taxRefundArchivedAt
    || order.taxSubmittedAt
    || BUSINESS_ARCHIVE_TAX_STATUSES.includes(String(order.taxRefundStatus || "").trim()),
  );
}

export function assertBusinessNotArchived(
  order: BusinessArchiveOrderLike | null | undefined,
  message = "该订单已提交退税并归档，只允许查看和下载历史资料。",
) {
  if (!isBusinessArchived(order)) return;
  throw codedError(message, 400, "BUSINESS_ARCHIVED_READ_ONLY");
}

export async function lockBusinessOrderForUpdate(tx: Prisma.TransactionClient, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "receivable_orders"
    WHERE "id" = ${orderId}
    FOR UPDATE
  `);
  if (!rows.length) throw codedError("关联订单不存在或已删除。", 404, "BUSINESS_ORDER_NOT_FOUND");
}

export async function assertBusinessOrderWritableInTransaction(
  tx: Prisma.TransactionClient,
  orderId: string,
  message = "该订单已提交退税并归档，只允许查看和下载历史资料。",
) {
  await lockBusinessOrderForUpdate(tx, orderId);
  const order = await tx.receivableOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      deletedAt: true,
      taxArchived: true,
      taxRefundStatus: true,
      taxRefundArchivedAt: true,
      taxSubmittedAt: true,
    },
  });
  if (!order || order.deletedAt) throw codedError("关联订单不存在或已删除。", 404, "BUSINESS_ORDER_NOT_FOUND");
  assertBusinessNotArchived(order, message);
  return order;
}

export function businessArchiveOrderWhere(scope: BusinessArchiveScope = "current"): Prisma.ReceivableOrderWhereInput {
  const archived: Prisma.ReceivableOrderWhereInput = {
    OR: [
      { taxArchived: true },
      { taxRefundArchivedAt: { not: null } },
      { taxSubmittedAt: { not: null } },
      { taxRefundStatus: { in: BUSINESS_ARCHIVE_TAX_STATUSES } },
    ],
  };
  if (scope === "archive") return archived;
  if (scope === "all") return {};
  return {
    AND: [
      { taxArchived: false },
      { taxRefundArchivedAt: null },
      { taxSubmittedAt: null },
      { taxRefundStatus: { notIn: BUSINESS_ARCHIVE_TAX_STATUSES } },
    ],
  };
}
