import { prisma } from "../prisma";
import { orderAccessWhere } from "./order-access";
import { canRead } from "./shared-access";
import {
  FACTORY_SUPPLIER_COST_TYPES,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
  getCommissionFormulaSettings,
  includeOrderRelations,
  nonEmpty,
  summarizeOrder,
  validCost,
} from "./shared";
import {
  NEGATIVE_PROFIT_THRESHOLD,
  PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE,
  PROFIT_COST_REQUIRED_STATUSES,
  PROFIT_COST_REVIEW_STATUSES,
  TODO_LIMIT_PER_SOURCE,
  isFinanceOperator,
  orderHref,
  roleOwner,
  todoForOrder,
  type ProfitOrder,
  type WorkbenchTodo,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";
import {
  doneSupplierDocumentRequests,
  supplierDocumentRequestHasFactoryCost,
  taxRefundFinalized,
  type WorkbenchWorkflowOrder,
} from "./workbench-todos-workflow-helpers";

function isCommissionSettled(order: { commissionStatus?: string | null }) {
  return ["已结算", "SETTLED"].includes(nonEmpty(order.commissionStatus));
}

function profitOrderDueDate(order: ProfitOrder) {
  return order.dueDate || order.expectedPaymentDate || order.updatedAt;
}

function shouldCreateProfitCostIncompleteTodo(order: { status?: string | null }, validCosts: unknown[], summary: { allCostsConfirmed?: boolean }) {
  const status = nonEmpty(order.status);
  if (!PROFIT_COST_REVIEW_STATUSES.includes(status)) return false;
  return validCosts.length > 0 ? !summary.allCostsConfirmed : PROFIT_COST_REQUIRED_STATUSES.includes(status);
}

export async function listProfitTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!isFinanceOperator(actor) || !canRead(actor, "orders") || !canRead(actor, "costs") || !canRead(actor, "commissions")) return [];
  const [rows, commissionFormulaSettings] = await Promise.all([
    prisma.receivableOrder.findMany({
      where: { deletedAt: null, status: { notIn: ["已关闭", "已取消"] }, AND: [orderAccessWhere(actor)] },
      include: includeOrderRelations(),
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
    getCommissionFormulaSettings(),
  ]);
  const todos: WorkbenchTodo[] = [];
  const financeOwner = roleOwner(context, "FINANCE");
  const blockedRows = rows.length ? await prisma.supplierDocumentRequest.findMany({
    where: { deletedAt: null, orderId: { in: rows.map((order) => order.id) }, status: { notIn: PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE } },
    select: {
      orderId: true, supplierId: true, costId: true, deletedAt: true,
      cost: { select: { id: true, supplierId: true, sourceType: true, costType: true, status: true, deletedAt: true } },
      order: { select: { costs: {
        where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID }, sourceType: { notIn: LOGISTICS_GENERATED_COST_SOURCE_TYPES }, costType: { in: FACTORY_SUPPLIER_COST_TYPES } },
        select: { id: true, supplierId: true, sourceType: true, costType: true, status: true, deletedAt: true }, take: 50,
      } } },
    },
    take: Math.min(rows.length * 20, 1000),
  }) : [];
  const blockedOrderIds = new Set(blockedRows.filter(supplierDocumentRequestHasFactoryCost).map((row) => row.orderId));
  for (const order of rows) {
    const workflowOrder = order as WorkbenchWorkflowOrder;
    if (blockedOrderIds.has(order.id) || !doneSupplierDocumentRequests(workflowOrder)) continue;
    const summary = summarizeOrder(order, commissionFormulaSettings);
    const validCosts = (order.costs || []).filter(validCost);
    if (shouldCreateProfitCostIncompleteTodo(order, validCosts, summary)) {
      todos.push(todoForOrder({ type: "PROFIT_COST_INCOMPLETE", title: "成本未完整录入", module: "利润分析", order, context,
        dueAt: order.expectedShipmentDate || profitOrderDueDate(order), href: orderHref("/profit", order), owner: financeOwner, updatedAt: order.updatedAt }));
    }
    const taxFinalized = taxRefundFinalized(workflowOrder);
    if (summary.commissionCanSettle && taxFinalized && !isCommissionSettled(order)) {
      todos.push(todoForOrder({ type: "COMMISSION_SETTLEMENT", title: "提成待结算", module: "利润分析", order, context,
        dueAt: order.commissionSettledAt || order.updatedAt, href: orderHref("/profit", order), owner: financeOwner, updatedAt: order.updatedAt }));
    }
    const expectedProfit = Number(summary.expectedGrossProfit || 0);
    const realizedProfit = Number(summary.realizedGrossProfit || 0);
    const expectedMargin = summary.expectedGrossMargin == null ? null : Number(summary.expectedGrossMargin);
    const realizedMargin = summary.realizedGrossMargin == null ? null : Number(summary.realizedGrossMargin);
    const hasProfitException = summary.profitMarginEligible && (
      expectedProfit < NEGATIVE_PROFIT_THRESHOLD || realizedProfit < NEGATIVE_PROFIT_THRESHOLD
      || (expectedMargin != null && expectedMargin < NEGATIVE_PROFIT_THRESHOLD)
      || (realizedMargin != null && realizedMargin < NEGATIVE_PROFIT_THRESHOLD)
    );
    if (hasProfitException && summary.allCostsConfirmed && summary.logisticsCostConfirmed && taxFinalized) {
      todos.push(todoForOrder({ type: "PROFIT_EXCEPTION_REVIEW", title: "利润异常订单待复核", module: "利润分析", order, context,
        dueAt: order.updatedAt, href: orderHref("/profit", order), owner: financeOwner, updatedAt: order.updatedAt }));
    }
  }
  return todos;
}
