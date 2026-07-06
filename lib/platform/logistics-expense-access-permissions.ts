import { Prisma } from "../generated/prisma/client.js";
import {
  LOGISTICS_EXPENSE_AUDIT_STATUSES,
  LOGISTICS_EXPENSE_INVOICE_STATUSES,
  canRead,
  canWrite,
  nonEmpty,
  permissionError,
} from "./shared";
import {
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  LogisticsActor,
  logisticsExpenseActorId,
  logisticsExpenseActorRole,
} from "./logistics-expense-access-model";
import { orderSalespersonOwnershipWhere } from "./order-access";

export function logisticsExpenseAccessWhere(actor: LogisticsActor): Prisma.LogisticsExpenseWhereInput {
  const role = logisticsExpenseActorRole(actor);
  const id = logisticsExpenseActorId(actor);
  if (role === "管理员") return {};
  if (role === "财务") return { bill: { is: { auditStatus: "审核通过" } } };
  if (role === "业务员") return { order: { is: orderSalespersonOwnershipWhere(id) } };
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role)) {
    if (!actor) return { supplierId: "__no_supplier_bound__" };
    if (actor.supplierId) return { supplierId: actor.supplierId };
    return { supplierId: "__no_supplier_bound__" };
  }
  return { id: "__no_logistics_expense_access__" };
}

export function assertCanReadLogisticsExpenses(actor: LogisticsActor) {
  const role = logisticsExpenseActorRole(actor);
  if (role === "管理员" || role === "财务") return;
  if (canRead(actor, "domesticLogistics") || canRead(actor, "costs")) return;
  throw permissionError("无权限查看物流费用", 403);
}

export function assertCanWriteLogisticsExpense(actor: LogisticsActor) {
  if (logisticsExpenseActorRole(actor) === "业务员") return;
  if (canWrite(actor, "logistics")) return;
  throw permissionError("无权限录入物流费用", 403);
}

export function assertCanReviewLogisticsExpense(actor: LogisticsActor) {
  if (logisticsExpenseActorRole(actor) === "管理员") return;
  throw permissionError("只有管理员可以审核物流费用", 403);
}

export function assertCanConfirmLogisticsInvoice(actor: LogisticsActor) {
  if (["管理员", "财务"].includes(logisticsExpenseActorRole(actor))) return;
  throw permissionError("只有管理员或财务可以确认物流发票", 403);
}

export function logisticsExpenseStatusWhere(status = ""): Prisma.LogisticsExpenseWhereInput {
  const text = nonEmpty(status);
  if (!text || text === "all") return {};
  const auditWhere = (value: string): Prisma.LogisticsExpenseWhereInput => ({
    bill: { is: { auditStatus: value } },
  });
  const invoiceWhere = (value: string): Prisma.LogisticsExpenseWhereInput => {
    const billValue = value === "已上传" ? "已上传发票" : value;
    return { bill: { is: { invoiceStatus: billValue } } };
  };
  if (text === "pending") return auditWhere("待审核");
  if (text === "approved") return auditWhere("审核通过");
  if (text === "rejected") return auditWhere("已驳回");
  if (text === "draft") return auditWhere("草稿");
  if (text === "toInvoice") return {
    AND: [
      auditWhere("审核通过"),
      { bill: { is: { invoiceStatus: { in: ["未通知", "已通知开票", "待开票", "通知失败", "待开票 / 通知失败"] } } } },
    ],
  };
  if (text === "uploaded") return invoiceWhere("已上传发票");
  if (text === "confirmedInvoice") return invoiceWhere("已确认");
  if (LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(text)) return auditWhere(text);
  if (LOGISTICS_EXPENSE_INVOICE_STATUSES.includes(text)) return invoiceWhere(text);
  return {};
}

export function insensitiveContains(value: unknown): Prisma.StringFilter | null {
  const text = nonEmpty(value);
  return text ? { contains: text, mode: "insensitive" } : null;
}
