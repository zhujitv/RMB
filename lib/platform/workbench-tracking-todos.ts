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

function trackingTodoOrder(row: {
  orderId?: string;
  orderNo?: string;
  customerName?: string;
  customerShortName?: string;
  updatedAt?: string;
}): TodoOrder | null {
  const orderId = nonEmpty(row.orderId);
  const orderNo = nonEmpty(row.orderNo);
  if (!orderId || !orderNo) return null;
  return {
    id: orderId,
    orderNo,
    customerNameSnapshot: nonEmpty(row.customerName) || nonEmpty(row.customerShortName),
    customer: { shortName: nonEmpty(row.customerShortName) },
    updatedAt: row.updatedAt,
  };
}

export async function listOceanTrackingTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "domesticLogistics") || !(isAdmin(actor) || isSalesperson(actor) || isLogisticsOperator(actor))) return [];
  const result = await listShipsgoControlTowerTrackings(new URLSearchParams(), actor);
  const todos: WorkbenchTodo[] = [];
  for (const row of result.rows || []) {
    const order = trackingTodoOrder(row);
    if (!order) continue;
    const owner = salespersonOwner(order);
    const href = orderHref("/ocean-control-tower", order, {
      trackingId: row.id,
      keyword: order.orderNo,
    });
    if (row.hasDumpingWarning) {
      todos.push(todoForOrder({
        id: `container-dumping-alert-${row.id}`,
        type: "CONTAINER_TRACKING_EXCEPTION",
        title: "甩柜预警",
        module: "运输监控",
        order,
        context,
        dueAt: row.dumpingWarningAt || row.lastEventAt || new Date(),
        href,
        owner,
        updatedAt: row.updatedAt,
      }));
    }
    if (row.isEtaOverdue) {
      todos.push(todoForOrder({
        id: `eta-arrival-${row.id}`,
        type: "ETA_ARRIVAL_ALERT",
        title: "ETA 已过期",
        module: "运输监控",
        order,
        context,
        dueAt: row.eta || row.predictedDischargeDate || row.dateOfDischarge,
        href,
        owner,
        updatedAt: row.updatedAt,
      }));
    }
    if (row.isSyncFailed || row.isSyncStale) {
      todos.push(todoForOrder({
        id: `container-tracking-exception-${row.id}`,
        type: "CONTAINER_TRACKING_EXCEPTION",
        title: "集装箱跟踪异常",
        module: "运输监控",
        order,
        context,
        dueAt: row.isSyncFailed ? new Date() : (row.lastSyncTime || row.lastSyncedAt || row.updatedAt),
        href,
        owner,
        updatedAt: row.updatedAt,
      }));
    }
  }
  return todos;
}
