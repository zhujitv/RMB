import { prisma } from "../prisma";
import { orderAccessWhere } from "./order-access";
import { canRead } from "./shared-access";
import {
  TODO_LIMIT_PER_SOURCE,
  isAdmin,
  isFinance,
  isSalesperson,
  orderHref,
  taxRefundArchiveOwner,
  todoForOrder,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";

export function taxRefundArchivedTodosBatch(context: WorkbenchTodoContext, today: Date, tomorrow: Date) {
  const actor = context.actor;
  if (!(canRead(actor, "taxRefund") && (isAdmin(actor) || isSalesperson(actor) || isFinance(actor)))) return null;
  return prisma.receivableOrder.findMany({
    where: {
      deletedAt: null,
      taxArchived: true,
      taxRefundArchivedAt: { gte: today, lt: tomorrow },
      AND: [orderAccessWhere(actor)],
    },
    include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } },
    orderBy: [{ taxRefundArchivedAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  }).then((rows) => rows.map((order) => todoForOrder({
    type: "TAX_REFUND_ARCHIVED",
    title: "退税资料已归档",
    module: "退税资料",
    order,
    context,
    dueAt: order.taxRefundArchivedAt || order.updatedAt,
    href: orderHref("/tax-refund", order),
    owner: taxRefundArchiveOwner(context, order),
    status: "DONE",
    updatedAt: order.updatedAt,
  })));
}
