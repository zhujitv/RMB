import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertWrite,
  includeOrderRelations,
  nonEmpty,
  permissionError,
  requireText,
  writeAudit,
} from "./shared";
import {
  assertCommissionOrderWritableInTransaction,
  isCommissionSettled,
} from "./commission-settlement-lock";
import { assertBusinessOrderWritableInTransaction, isBusinessArchived } from "./business-archive";

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
    if (isCommissionSettled(row)) {
      unresolved.push({ orderId: row.id, orderNo: row.orderNo, reason: "业务员提成已结算，需先走撤销结算流程" });
      continue;
    }
    if (isBusinessArchived(row)) {
      unresolved.push({ orderId: row.id, orderNo: row.orderNo, reason: "订单已提交退税并归档，需先取消归档" });
      continue;
    }
    const result = await prisma.$transaction(async (tx) => {
      await assertBusinessOrderWritableInTransaction(
        tx,
        row.id,
        "该订单已提交退税并归档，修正业务员前请先取消归档。",
      );
      await assertCommissionOrderWritableInTransaction(tx, row.id);
      const current = await tx.receivableOrder.findUnique({
        where: { id: row.id },
        include: { customer: true, createdBy: true },
      });
      if (!current || current.deletedAt || current.salespersonUserId) return null;
      const customerSalespersonId = nonEmpty(current.customer?.salespersonUserId);
      const createdBySalespersonId = current.createdBy?.role === "业务员" ? nonEmpty(current.createdById) : "";
      const nextSalespersonId = customerSalespersonId || createdBySalespersonId;
      if (!nextSalespersonId) return null;
      const patch: Prisma.ReceivableOrderUpdateInput = {
        salesperson: { connect: { id: nextSalespersonId } },
        updatedBy: { connect: { id: actorId(actor) } },
      };
      if (!Number(current.salespersonCommissionRate || 0) && customerSalespersonId) {
        patch.salespersonCommissionRate = Math.max(0, Number(current.customer?.commissionStatus === "停用" ? 0 : current.customer?.commissionRate || 0));
      }
      const updated = await tx.receivableOrder.update({
        where: { id: row.id },
        data: patch,
        include: includeOrderRelations(),
      });
      await writeAudit(request, actor, "修正订单业务员归属", "receivable_orders", row.id, current, updated, tx);
      return {
        updated,
        salespersonUserId: nextSalespersonId,
        source: customerSalespersonId ? "customer.salespersonUserId" : "createdById",
      };
    });
    if (!result) {
      unresolved.push({ orderId: row.id, orderNo: row.orderNo, reason: "缺少客户负责业务员，创建人也不是业务员，或订单已由其他操作修正" });
      continue;
    }
    repaired.push({
      orderId: row.id,
      orderNo: row.orderNo,
      salespersonUserId: result.salespersonUserId,
      source: result.source,
    });
  }
  return {
    scanned: rows.length,
    repaired: repaired.length,
    unresolved: unresolved.length,
    repairedRows: repaired,
    unresolvedRows: unresolved,
  };
}
