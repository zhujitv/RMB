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
  doneSupplierDocumentRequests,
  supplierDocumentRequestHasFactoryCost,
  supplierDocumentRequestMatchesCost,
  type WorkbenchWorkflowOrder,
} from "./workbench-todos-workflow-helpers";

export async function listSupplierDocumentTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "supplierDocuments")) return [];
  const productSupplier = isProductSupplierOperatorRole(actorRole(actor));
  const where: Prisma.SupplierDocumentRequestWhereInput = {
    deletedAt: null,
    status: { notIn: PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE },
    ...(productSupplier
      ? {
          supplierId: actorSupplierId(actor) || "__no_supplier_bound__",
          supplier: { allowFactoryDocumentUpload: true, status: "启用", deletedAt: null },
        }
      : {}),
  };
  if (!isAdmin(actor) && !productSupplier) return [];
  const rows = await prisma.supplierDocumentRequest.findMany({
    where,
    include: {
      order: {
        include: {
          customer: true,
          salesperson: { select: { id: true, name: true, email: true, role: true } },
          costs: {
	            where: { deletedAt: null, sourceType: { notIn: LOGISTICS_GENERATED_COST_SOURCE_TYPES }, costType: { in: FACTORY_SUPPLIER_COST_TYPES } },
            select: { id: true, supplierId: true, sourceType: true, costType: true, deletedAt: true },
            take: 50,
          },
        },
      },
      supplier: {
        include: {
          operatorUsers: {
            where: { isActive: true, approvalStatus: "APPROVED" },
            select: { id: true, name: true, email: true, role: true, supplierId: true },
          },
        },
      },
      cost: {
        select: { id: true, supplierId: true, sourceType: true, costType: true, deletedAt: true },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  return rows.filter(supplierDocumentRequestHasFactoryCost).map((row) => todoForOrder({
    type: "SUPPLIER_DOCUMENT_RETURN",
    title: "供应商资料待回传",
    module: "资料回传",
    order: row.order,
    context,
    dueAt: row.dueDate,
    href: orderHref("/supplier-documents", row.order, {
      requestId: row.id,
      keyword: row.order.orderNo,
    }),
    owner: supplierOwner(context, row.supplier, "PRODUCT_SUPPLIER", "产品供应商"),
    ownerName: row.supplier?.supplierName || (productSupplier ? "当前供应商" : "产品供应商"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listCustomerPaymentTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "payments") || !isFinanceOperator(actor)) return [];
  const rows = await prisma.payment.findMany({
    where: {
      deletedAt: null,
      status: "待确认",
      order: { is: orderAccessWhere(actor) },
    },
    include: {
      order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
    },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  return rows.map((payment) => todoForPayment({
    type: "CUSTOMER_PAYMENT_CONFIRMATION",
    title: "客户回款待确认",
    payment,
    context,
    owner: roleOwner(context, "FINANCE"),
  }));
}

export async function listFactoryPaymentTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "costs") || !isFinanceOperator(actor)) return [];
  const baseWhere = productSupplierPaymentCostWhere();
  const include = {
    order: {
      include: {
        customer: true,
        salesperson: { select: { id: true, name: true, email: true, role: true } },
        supplierDocumentRequests: {
          where: { deletedAt: null },
          select: { status: true, supplierId: true, costId: true, completedAt: true, deletedAt: true },
          take: 50,
        },
        documents: {
          where: { deletedAt: null, relatedModule: "SUPPLIER", documentType: { in: ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"] } },
          select: { documentType: true, uploadStatus: true, relatedModule: true, costId: true, supplierId: true, deletedAt: true },
          take: 100,
        },
      },
    },
    supplier: { select: { id: true, supplierName: true, supplierType: true } },
    documents: {
      where: { deletedAt: null, relatedModule: "SUPPLIER", documentType: { in: ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"] } },
      select: { documentType: true, uploadStatus: true, relatedModule: true, costId: true, supplierId: true, deletedAt: true },
      take: 10,
    },
  } satisfies Prisma.OrderCostInclude;
  const [unpaidCosts, missingVoucherCosts, missingPaidAtCosts] = await Promise.all([
    prisma.orderCost.findMany({
      where: {
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        paymentStatus: { not: "已取消" },
        AND: [
          baseWhere,
          {
            OR: [
              { paid: false },
              { paymentStatus: { in: ["待支付", "部分支付"] } },
            ],
          },
        ],
      },
      include,
      orderBy: [{ paymentDate: "asc" }, { updatedAt: "asc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
    prisma.orderCost.findMany({
      where: {
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        paymentStatus: { not: "已取消" },
        AND: [
          baseWhere,
          {
            OR: [
              { sourceType: { not: "FACTORY_PURCHASE_SETTLEMENT" }, paid: true },
              { sourceType: "FACTORY_PURCHASE_SETTLEMENT", paymentStatus: "已支付" },
            ],
          },
          { paymentDate: { gte: context.paymentVoucherReminderStartDate } },
          { paymentVoucherStorageKey: null },
          { paymentVoucherUrl: null },
        ],
      },
      include,
      orderBy: [{ paymentDate: "asc" }, { paidAt: "asc" }, { updatedAt: "asc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
    prisma.orderCost.findMany({
      where: {
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        paymentStatus: { not: "已取消" },
        paidAt: null,
        AND: [
          baseWhere,
          paidCostWhere(),
        ],
      },
      include,
      orderBy: [{ updatedAt: "asc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
  ]);
  const todos: WorkbenchTodo[] = [];
  const handledCostIds = new Set<string>();
  function addCostTodo(cost: TodoCost, buildTodo: () => WorkbenchTodo) {
    if (!isProductSupplierPaymentCost(cost) || handledCostIds.has(cost.id)) return;
    const supplierId = cost.supplierId || cost.supplier?.id || null;
    const supplierDocumentRequests = ((cost.order as WorkbenchWorkflowOrder).supplierDocumentRequests || [])
      .filter((request) => supplierDocumentRequestMatchesCost(request, { id: cost.id, supplierId }));
    const workflowOrder = {
      ...(cost.order as WorkbenchWorkflowOrder),
      supplierDocumentRequests,
      costs: [{
        id: cost.id,
        supplierId,
        sourceType: cost.sourceType || null,
        costType: cost.costType || null,
        deletedAt: null,
        documents: cost.documents || [],
      }],
    } satisfies WorkbenchWorkflowOrder;
    if (!doneSupplierDocumentRequests(workflowOrder)) return;
    handledCostIds.add(cost.id);
    todos.push(buildTodo());
  }

  missingPaidAtCosts.forEach((cost) => addCostTodo(cost, () => todoForCost({
    type: "PAID_WITHOUT_PAYMENT_TIME",
    title: "已付款但缺付款时间",
    module: "成本管理",
    cost,
    context,
    dueAt: cost.updatedAt,
    owner: roleOwner(context, "FINANCE"),
  })));
  missingVoucherCosts.forEach((cost) => addCostTodo(cost, () => todoForCost({
    type: "PAYMENT_VOUCHER_UPLOAD",
    title: "付款凭证待上传",
    module: "成本管理",
    cost,
    context,
    dueAt: cost.paymentDate || cost.paidAt || cost.updatedAt,
    owner: roleOwner(context, "FINANCE"),
  })));
  unpaidCosts.forEach((cost) => addCostTodo(cost, () => todoForCost({
    type: "FACTORY_PAYMENT_REGISTER",
    title: "工厂付款待登记",
    module: "成本管理",
    cost,
    context,
    dueAt: cost.paymentDate || cost.order.expectedShipmentDate || cost.order.dueDate,
    owner: roleOwner(context, "FINANCE"),
  })));
  return todos;
}
