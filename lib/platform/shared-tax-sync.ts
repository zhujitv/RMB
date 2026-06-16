import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { includeOrderRelations } from "./shared-order-relations";
import { taxDocumentCompleteness, taxRefundStatusFromCompleteness } from "./shared-tax-completeness";

export async function refreshTaxRefundCompleteness(orderId: string | null | undefined) {
  if (!orderId) return null;
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: includeOrderRelations(),
  });
  if (!order) return null;
  const completeness = JSON.parse(JSON.stringify(taxDocumentCompleteness(order))) as ReturnType<typeof taxDocumentCompleteness>;
  const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  await prisma.receivableOrder.update({
    where: { id: order.id },
    data: {
      taxRefundCompleteness: completeness as Prisma.InputJsonValue,
      taxRefundCompletenessUpdatedAt: new Date(),
      ...(status !== order.taxRefundStatus ? { taxRefundStatus: status } : {}),
    },
  });
  return completeness;
}

export async function syncCostInvoiceStatus(costId: string | null | undefined) {
  if (!costId) return null;
  const cost = await prisma.orderCost.findFirst({
    where: { id: costId, deletedAt: null },
    select: { sourceType: true, invoiceStatus: true },
  });
  if (!cost) return null;
  const invoiceCount = await prisma.orderDocument.count({
    where: {
      costId,
      documentType: "SUPPLIER_INVOICE",
      uploadStatus: "SUCCESS",
      deletedAt: null,
    },
  });
  if (cost.sourceType === "LOGISTICS_EXPENSE") {
    const invoiceStatus = invoiceCount > 0 ? "已收到" : (cost.invoiceStatus || "未通知");
    return prisma.orderCost.update({
      where: { id: costId },
      data: { invoiceStatus },
    });
  }
  const invoiceStatus = invoiceCount > 0 ? "已收到" : "未收到";
  return prisma.orderCost.update({
    where: { id: costId },
    data: { invoiceStatus },
  });
}
