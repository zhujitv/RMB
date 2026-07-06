import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { orderAccessWhere } from "./order-access";
import { canRead } from "./shared-access";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  FACTORY_SUPPLIER_COST_TYPES,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  ORDER_COST_STATUS_VOID,
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
import {
  customsDeclarationUploaded,
  doneSupplierDocumentRequests,
  supplierDocumentRequestHasFactoryCost,
  taxRefundFinalized,
  type WorkbenchWorkflowOrder,
} from "./workbench-todos-workflow-helpers";

function missingTaxRefundTodos(context: WorkbenchTodoContext, order: TodoOrder, missingLabels: string[] = []) {
  const owner = roleOwner(context, "FINANCE");
  const rules = [
    { type: "TAX_TRUCKING_INVOICE_MISSING", title: "拖车发票缺失", pattern: /拖车|物流费资料|物流费发票/ },
    { type: "TAX_PURCHASE_CONTRACT_MISSING", title: "采购合同缺失", pattern: /采购合同|工厂合同/ },
    { type: "TAX_VAT_INVOICE_MISSING", title: "增值税发票缺失", pattern: /增值税发票|工厂发票/ },
  ];
  return rules
    .filter((rule) => missingLabels.some((label) => rule.pattern.test(label)))
    .map((rule) => todoForOrder({
      type: rule.type,
      title: rule.title,
      module: "退税资料",
      order,
      context,
      href: orderHref("/tax-refund", order),
      owner,
      updatedAt: order.updatedAt,
    }));
}

function normalizedMissingLabels(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => nonEmpty(item)).filter(Boolean)
    : [];
}

export async function listTaxRefundTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "taxRefund") || !(isAdmin(actor) || isSalesperson(actor) || isFinance(actor))) return [];
  const rows = await prisma.receivableOrder.findMany({
    where: {
      deletedAt: null,
      taxArchived: false,
      taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES },
      documents: {
        some: {
          deletedAt: null,
          documentType: "CUSTOMS_ENTRY_FORM",
          uploadStatus: "SUCCESS",
          relatedModule: { not: "SUPPLIER" },
        },
      },
      AND: [orderAccessWhere(actor)],
    },
    include: {
      customer: true,
      salesperson: { select: { id: true, name: true, email: true, role: true } },
      documents: {
        where: { deletedAt: null, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS" },
        select: { documentType: true, uploadStatus: true, relatedModule: true, deletedAt: true },
        take: 5,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  const refreshedById = await refreshTaxRefundCompletenessBatch(
    rows.filter(needsTaxRefundCompletenessRefresh).map((order) => order.id),
  );
  const todos: WorkbenchTodo[] = [];
  const owner = roleOwner(context, "FINANCE");
  for (const order of rows) {
    const workflowOrder = order as WorkbenchWorkflowOrder;
    if (!customsDeclarationUploaded(workflowOrder)) continue;
    const completeness = refreshedById.get(order.id) || cachedTaxRefundCompleteness(order);
    const total = Number(completeness.total || 0);
    const completed = Number(completeness.completed || 0);
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const orderWithCompleteness = refreshedById.has(order.id)
      ? { ...order, taxRefundCompleteness: completeness }
      : order;
    const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
    if (total > 0 && completed < total) {
      todos.push(todoForOrder({
        type: "TAX_REFUND_INCOMPLETE",
        title: `退税资料完整度不足 100%（${percent}%）`,
        module: "退税资料",
        order: orderWithCompleteness,
        context,
        href: orderHref("/tax-refund", order),
        owner,
        updatedAt: order.updatedAt,
      }));
      todos.push(...missingTaxRefundTodos(context, orderWithCompleteness, normalizedMissingLabels(completeness.missingLabels)));
    } else if (total > 0 && status !== "SUBMITTED" && !order.taxSubmittedAt && !order.taxRefundArchivedAt) {
      todos.push(todoForOrder({
        type: "TAX_REFUND_READY_NOT_ARCHIVED",
        title: "已满足退税条件但未归档",
        module: "退税资料",
        order: orderWithCompleteness,
        context,
        dueAt: order.taxRefundCompletenessUpdatedAt || order.updatedAt,
        href: orderHref("/tax-refund", order, {
          status: "READY",
          action: "submitTaxArchive",
        }),
        owner: taxRefundArchiveOwner(context, orderWithCompleteness),
        updatedAt: order.updatedAt,
      }));
    }
  }
  return todos;
}

function isCommissionSettled(order: { commissionStatus?: string | null }) {
  return ["已结算", "SETTLED"].includes(nonEmpty(order.commissionStatus));
}

function profitOrderDueDate(order: ProfitOrder) {
  return order.dueDate || order.expectedPaymentDate || order.updatedAt;
}

function shouldCreateProfitCostIncompleteTodo(
  order: { status?: string | null },
  validCosts: unknown[],
  summary: { allCostsConfirmed?: boolean },
) {
  const status = nonEmpty(order.status);
  if (!PROFIT_COST_REVIEW_STATUSES.includes(status)) return false;
  if (validCosts.length > 0) return !summary.allCostsConfirmed;
  return PROFIT_COST_REQUIRED_STATUSES.includes(status);
}

export async function listProfitTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!isFinanceOperator(actor) || !canRead(actor, "orders") || !canRead(actor, "costs") || !canRead(actor, "commissions")) return [];
  const [rows, commissionFormulaSettings] = await Promise.all([
    prisma.receivableOrder.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ["已关闭", "已取消"] },
        AND: [orderAccessWhere(actor)],
      },
      include: includeOrderRelations(),
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
    getCommissionFormulaSettings(),
  ]);
  const todos: WorkbenchTodo[] = [];
  const financeOwner = roleOwner(context, "FINANCE");
  const blockedSupplierDocumentRows = rows.length
    ? await prisma.supplierDocumentRequest.findMany({
        where: {
          deletedAt: null,
          orderId: { in: rows.map((order) => order.id) },
          status: { notIn: PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE },
        },
        select: {
          orderId: true,
          supplierId: true,
          costId: true,
          deletedAt: true,
          cost: {
            select: { id: true, supplierId: true, sourceType: true, costType: true, status: true, deletedAt: true },
          },
          order: {
            select: {
              costs: {
	                where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID }, sourceType: { notIn: LOGISTICS_GENERATED_COST_SOURCE_TYPES }, costType: { in: FACTORY_SUPPLIER_COST_TYPES } },
                select: { id: true, supplierId: true, sourceType: true, costType: true, status: true, deletedAt: true },
                take: 50,
              },
            },
          },
        },
        take: Math.min(rows.length * 20, 1000),
      })
    : [];
  const supplierDocumentBlockedOrderIds = new Set(
    blockedSupplierDocumentRows.filter(supplierDocumentRequestHasFactoryCost).map((row) => row.orderId),
  );
  for (const order of rows) {
    const workflowOrder = order as WorkbenchWorkflowOrder;
    if (supplierDocumentBlockedOrderIds.has(order.id) || !doneSupplierDocumentRequests(workflowOrder)) continue;
    const summary = summarizeOrder(order, commissionFormulaSettings);
    const validCosts = (order.costs || []).filter(validCost);
    if (shouldCreateProfitCostIncompleteTodo(order, validCosts, summary)) {
      todos.push(todoForOrder({
        type: "PROFIT_COST_INCOMPLETE",
        title: "成本未完整录入",
        module: "利润分析",
        order,
        context,
        dueAt: order.expectedShipmentDate || profitOrderDueDate(order),
        href: orderHref("/profit", order),
        owner: financeOwner,
        updatedAt: order.updatedAt,
      }));
    }
    const taxFinalized = taxRefundFinalized(workflowOrder);
    if (summary.commissionCanSettle && taxFinalized && !isCommissionSettled(order)) {
      todos.push(todoForOrder({
        type: "COMMISSION_SETTLEMENT",
        title: "提成待结算",
        module: "利润分析",
        order,
        context,
        dueAt: order.commissionSettledAt || order.updatedAt,
        href: orderHref("/profit", order),
        owner: financeOwner,
        updatedAt: order.updatedAt,
      }));
    }
    const expectedProfit = Number(summary.expectedGrossProfit || 0);
    const realizedProfit = Number(summary.realizedGrossProfit || 0);
    const expectedMargin = summary.expectedGrossMargin == null ? null : Number(summary.expectedGrossMargin);
    const realizedMargin = summary.realizedGrossMargin == null ? null : Number(summary.realizedGrossMargin);
    const hasProfitException = expectedProfit < NEGATIVE_PROFIT_THRESHOLD
      || realizedProfit < NEGATIVE_PROFIT_THRESHOLD
      || (expectedMargin != null && expectedMargin < NEGATIVE_PROFIT_THRESHOLD)
      || (realizedMargin != null && realizedMargin < NEGATIVE_PROFIT_THRESHOLD);
    if (hasProfitException && summary.allCostsConfirmed && summary.logisticsCostConfirmed && taxFinalized) {
      todos.push(todoForOrder({
        type: "PROFIT_EXCEPTION_REVIEW",
        title: "利润异常订单待复核",
        module: "利润分析",
        order,
        context,
        dueAt: order.updatedAt,
        href: orderHref("/profit", order),
        owner: financeOwner,
        updatedAt: order.updatedAt,
      }));
    }
  }
  return todos;
}
