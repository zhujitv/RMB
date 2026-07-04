import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { orderAccessWhere } from "./order-access";
import { canRead } from "./shared-access";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  FACTORY_SUPPLIER_COST_TYPES,
  getCommissionFormulaSettings,
  includeOrderRelations,
  isProductSupplierOperatorRole,
  listShipsgoControlTowerTrackings,
  nonEmpty,
  needsTaxRefundCompletenessRefresh,
  cachedTaxRefundCompleteness,
  refreshTaxRefundCompletenessBatch,
  summarizeOrder,
  taxRefundStatusFromCompleteness,
  validCost,
} from "./shared";
import {
  LOGISTICS_INVOICE_DONE_STATUSES,
  LOGISTICS_INVOICE_REVIEW_STATUSES,
  LOGISTICS_PAYMENT_DONE_STATUSES,
  LOGISTICS_PAYMENT_READY_INVOICE_STATUSES,
  NEGATIVE_PROFIT_THRESHOLD,
  PROFIT_COST_REQUIRED_STATUSES,
  PROFIT_COST_REVIEW_STATUSES,
  PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE,
  TODO_LIMIT_PER_SOURCE,
  activeOrderBaseWhere,
  actorRole,
  actorSupplierId,
  isAdmin,
  isFinance,
  isFinanceOperator,
  isLogisticsOperator,
  isLogisticsSupplier,
  isPurchase,
  isSalesperson,
  logisticsBillAccessWhere,
  logisticsOwnerForOrder,
  orderHref,
  paidCostWhere,
  productSupplierPaymentCostWhere,
  roleOwner,
  salespersonOwner,
  supplierOwner,
  taxRefundArchiveOwner,
  todoForCost,
  todoForLogisticsBill,
  todoForOrder,
  todoForPayment,
  isProductSupplierPaymentCost,
  type ProfitOrder,
  type TodoCost,
  type TodoOrder,
  type WorkbenchTodo,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";

export async function listOrderTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "orders") || !(isAdmin(actor) || isSalesperson(actor) || isPurchase(actor))) return [];
  const [draftOrders, purchasePendingOrders] = await Promise.all([
    prisma.receivableOrder.findMany({
      where: {
        deletedAt: null,
        status: { in: ["草稿", "待审核"] },
        AND: [orderAccessWhere(actor)],
      },
      include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
    prisma.receivableOrder.findMany({
      where: {
        deletedAt: null,
        status: { in: ["已确认", "生产中"] },
        AND: [orderAccessWhere(actor)],
        costs: {
          none: {
            deletedAt: null,
            costType: { in: FACTORY_SUPPLIER_COST_TYPES },
          },
        },
      },
      include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
  ]);
  return [
    ...draftOrders.map((order) => todoForOrder({
      type: "NEW_ORDER_REVIEW",
      title: "新订单待审核",
      module: "应收订单",
      order,
      context,
      dueAt: order.dueDate || order.expectedShipmentDate,
      href: orderHref("/orders", order),
      owner: roleOwner(context, "ADMIN"),
    })),
    ...purchasePendingOrders.map((order) => todoForOrder({
      type: "PURCHASE_ORDER_PENDING",
      title: "采购订单待下达",
      module: "应收订单",
      order,
      context,
      dueAt: order.expectedShipmentDate || order.dueDate,
      href: orderHref("/orders", order),
      owner: roleOwner(context, "PURCHASE"),
    })),
  ];
}
