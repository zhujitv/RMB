import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertWrite,
  includeOrderRelations,
  nonEmpty,
  permissionError,
  requireText,
  runNonCriticalTask,
  writeAudit,
} from "./shared";

type ActorLike = ({
  id?: string | null;
  role?: string | null;
} & Record<string, unknown>) | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];

function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
}

export async function repairMissingOrderSalespeople(request: AuditRequestLike, actor: ActorLike) {
  assertWrite(actor, "orders");
  if (actorRole(actor) !== "管理员") throw permissionError("只有管理员可以修正订单业务员归属", 403);
  const rows = await prisma.receivableOrder.findMany({
    where: {
      deletedAt: null,
      salespersonUserId: null,
    },
    include: {
      customer: true,
      createdBy: true,
    },
    orderBy: [{ createdAt: "asc" }],
    take: 1000,
  });
  const repaired: Array<{ orderId: string; orderNo: string; salespersonUserId: string; source: string }> = [];
  const unresolved: Array<{ orderId: string; orderNo: string; reason: string }> = [];
  for (const row of rows) {
    const customerSalespersonId = nonEmpty(row.customer?.salespersonUserId);
    const createdBySalespersonId = row.createdBy?.role === "业务员" ? nonEmpty(row.createdById) : "";
    const nextSalespersonId = customerSalespersonId || createdBySalespersonId;
    if (!nextSalespersonId) {
      unresolved.push({ orderId: row.id, orderNo: row.orderNo, reason: "缺少客户负责业务员，创建人也不是业务员" });
      continue;
    }
    const patch: Prisma.ReceivableOrderUpdateInput = {
      salesperson: { connect: { id: nextSalespersonId } },
      updatedBy: { connect: { id: actorId(actor) } },
    };
    if (!Number(row.salespersonCommissionRate || 0) && customerSalespersonId) {
      patch.salespersonCommissionRate = Math.max(0, Number(row.customer?.commissionStatus === "停用" ? 0 : row.customer?.commissionRate || 0));
    }
    const updated = await prisma.receivableOrder.update({
      where: { id: row.id },
      data: patch,
      include: includeOrderRelations(),
    });
    repaired.push({
      orderId: row.id,
      orderNo: row.orderNo,
      salespersonUserId: nextSalespersonId,
      source: customerSalespersonId ? "customer.salespersonUserId" : "createdById",
    });
    await runNonCriticalTask("订单业务员历史修正日志写入", () => (
      writeAudit(request, actor, "修正订单业务员归属", "receivable_orders", row.id, row, updated)
    ), { context: { orderId: row.id, source: customerSalespersonId ? "customer" : "createdBy" } });
  }
  return {
    scanned: rows.length,
    repaired: repaired.length,
    unresolved: unresolved.length,
    repairedRows: repaired,
    unresolvedRows: unresolved,
  };
}
