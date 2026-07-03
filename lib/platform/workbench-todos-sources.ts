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
  refreshTaxRefundCompletenessForCustomsDeclaration,
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

export async function listDomesticLogisticsTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "domesticLogistics") || !(isAdmin(actor) || isSalesperson(actor) || isLogisticsOperator(actor))) return [];
  const where = activeOrderBaseWhere(actor);
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: {
      customer: true,
      salesperson: { select: { id: true, name: true, email: true, role: true } },
      logisticsSuppliers: {
        include: {
          supplier: {
            include: {
              operatorUsers: {
                where: { isActive: true, approvalStatus: "APPROVED" },
                select: { id: true, name: true, email: true, role: true, supplierId: true },
              },
            },
          },
        },
        orderBy: [{ assignedAt: "desc" }],
      },
      logisticsBills: {
        where: { deletedAt: null },
        select: { id: true, billOfLadingNo: true },
      },
      domesticLogisticsInfos: {
        where: { deletedAt: null },
        include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        orderBy: [{ updatedAt: "desc" }],
      },
      logisticsExpenses: {
        where: { deletedAt: null },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  const todos: WorkbenchTodo[] = [];
  for (const order of orders) {
    const logisticsOwner = logisticsOwnerForOrder(context, order);
    if (!order.domesticLogisticsInfos.length) {
      todos.push(todoForOrder({
        type: "LOGISTICS_INFO_MISSING",
        title: "物流信息待录入",
        module: "物流信息",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.dueDate,
        href: orderHref("/domestic-logistics", order),
        owner: logisticsOwner,
      }));
    }
    const hasBillNo = Boolean(nonEmpty(order.blNo) || order.logisticsBills.some((bill) => nonEmpty(bill.billOfLadingNo)));
    if (!hasBillNo) {
      todos.push(todoForOrder({
        type: "BILL_OF_LADING_MISSING",
        title: "提单号缺失",
        module: "物流信息",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/domestic-logistics", order),
        owner: logisticsOwner,
      }));
    }
    const hasContainerMissing = order.domesticLogisticsInfos.some((info) => (
      !info.transportItems.length || info.transportItems.some((item) => !nonEmpty(item.containerNo))
    ));
    if (hasContainerMissing) {
      todos.push(todoForOrder({
        type: "CONTAINER_NO_MISSING",
        title: "柜号缺失",
        module: "物流信息",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/domestic-logistics", order),
        owner: logisticsOwner,
      }));
    }
    if (!order.logisticsExpenses.length && (isAdmin(actor) || isSalesperson(actor) || isLogisticsSupplier(actor))) {
      todos.push(todoForOrder({
        type: "LOGISTICS_FEE_ENTRY",
        title: "物流费用待录入",
        module: "物流费用",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/logistics-fees", order),
        owner: logisticsOwner,
      }));
    }
  }
  return todos;
}

export async function listLogisticsFeeTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "domesticLogistics") && !canRead(actor, "costs")) return [];
  if (!(isAdmin(actor) || isSalesperson(actor) || isFinance(actor) || isLogisticsOperator(actor))) return [];
  const accessWhere = logisticsBillAccessWhere(actor);
  const [reviewBills, invoiceBills, invoiceReviewBills, paymentBills] = await Promise.all([
    prisma.logisticsBill.findMany({
      where: {
        deletedAt: null,
        AND: [
          { auditStatus: "待审核" },
          accessWhere,
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
        supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
      },
      orderBy: [{ submittedAt: "asc" }, { updatedAt: "asc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
    prisma.logisticsBill.findMany({
      where: {
        deletedAt: null,
        AND: [
          { auditStatus: "审核通过" },
          { invoiceStatus: { notIn: LOGISTICS_INVOICE_DONE_STATUSES } },
          accessWhere,
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
        supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
      },
      orderBy: [{ reviewedAt: "asc" }, { updatedAt: "asc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
    isFinanceOperator(actor)
      ? prisma.logisticsBill.findMany({
          where: {
            deletedAt: null,
            AND: [
              { auditStatus: "审核通过" },
              { invoiceStatus: { in: LOGISTICS_INVOICE_REVIEW_STATUSES } },
              { expenses: { some: { deletedAt: null, invoiceStatus: "已上传" } } },
              accessWhere,
            ],
          },
          include: {
            order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
            supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
          },
          orderBy: [{ updatedAt: "asc" }],
          take: TODO_LIMIT_PER_SOURCE,
        })
      : Promise.resolve([]),
    isFinanceOperator(actor)
      ? prisma.logisticsBill.findMany({
          where: {
            deletedAt: null,
            AND: [
              { auditStatus: "审核通过" },
              { invoiceStatus: { in: LOGISTICS_PAYMENT_READY_INVOICE_STATUSES } },
              { paymentStatus: { notIn: LOGISTICS_PAYMENT_DONE_STATUSES } },
              accessWhere,
            ],
          },
          include: {
            order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
            supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
          },
          orderBy: [{ paymentDate: "asc" }, { updatedAt: "asc" }],
          take: TODO_LIMIT_PER_SOURCE,
        })
      : Promise.resolve([]),
  ]);
  return [
    ...reviewBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_FEE_REVIEW",
      title: "物流费用待审核",
      bill,
      context,
      dueAt: bill.submittedAt || bill.updatedAt,
      owner: roleOwner(context, "FINANCE"),
    })),
    ...invoiceBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_INVOICE_UPLOAD",
      title: "物流发票待上传",
      bill,
      context,
      dueAt: bill.reviewedAt || bill.updatedAt,
      owner: bill.supplier ? supplierOwner(context, bill.supplier, "LOGISTICS_SUPPLIER", "物流供应商") : logisticsOwnerForOrder(context, bill.order),
      ownerName: bill.supplier?.supplierName || "物流供应商",
    })),
    ...invoiceReviewBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_INVOICE_REVIEW",
      title: "发票待审核",
      bill,
      context,
      dueAt: bill.updatedAt,
      owner: roleOwner(context, "FINANCE"),
      ownerName: "财务/管理员",
    })),
    ...paymentBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_PAYMENT_REGISTER",
      title: "物流付款待登记",
      bill,
      context,
      dueAt: bill.paymentDate || bill.updatedAt,
      owner: roleOwner(context, "FINANCE"),
      ownerName: "财务/管理员",
    })),
  ];
}

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
      order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
      supplier: {
        include: {
          operatorUsers: {
            where: { isActive: true, approvalStatus: "APPROVED" },
            select: { id: true, name: true, email: true, role: true, supplierId: true },
          },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  return rows.map((row) => todoForOrder({
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
    order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
    supplier: { select: { id: true, supplierName: true, supplierType: true } },
  } satisfies Prisma.OrderCostInclude;
  const [unpaidCosts, missingVoucherCosts, missingPaidAtCosts] = await Promise.all([
    prisma.orderCost.findMany({
      where: {
        deletedAt: null,
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
        paymentStatus: { not: "已取消" },
        AND: [
          baseWhere,
          { paid: true },
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

function missingTaxRefundTodos(context: WorkbenchTodoContext, order: TodoOrder, missingLabels: string[] = []) {
  const owner = roleOwner(context, "FINANCE");
  const rules = [
    { type: "TAX_TRUCKING_INVOICE_MISSING", title: "拖车发票缺失", pattern: /拖车|物流费资料|物流费发票/ },
    { type: "TAX_CUSTOMS_DECLARATION_MISSING", title: "报关单缺失", pattern: /报关单/ },
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
      href: taxRefundTodoHref(order),
      owner,
      updatedAt: order.updatedAt,
    }));
}

function normalizedMissingLabels(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => nonEmpty(item)).filter(Boolean)
    : [];
}

function taxRefundTodoOrderFromDeclaration(row: Prisma.CustomsDeclarationGetPayload<{
  include: { order: { include: { customer: true; salesperson: { select: { id: true; name: true; email: true; role: true } } } } };
}>) {
  return {
    ...row.order,
    id: row.id,
    orderId: row.orderId,
    customsDeclarationId: row.id,
    orderNo: row.order.orderNo,
    blNo: row.billOfLadingNo || row.order.blNo,
    billOfLadingNo: row.billOfLadingNo || row.order.blNo,
    customsDeclarationNo: row.declarationNo || "",
    customsDeclarationDate: row.declarationDate || null,
    taxRefundStatus: row.taxRefundStatus,
    taxRefundCompleteness: row.taxRefundCompleteness,
    taxRefundCompletenessUpdatedAt: row.taxRefundCompletenessUpdatedAt,
    taxRefundOverallCompleteness: row.taxRefundOverallCompleteness,
    taxRefundCompletenessIssuesSummary: row.taxRefundCompletenessIssuesSummary,
    taxArchived: row.taxArchived,
    taxSubmittedAt: row.taxSubmittedAt,
    taxRefundArchivedAt: row.taxRefundArchivedAt,
    updatedAt: row.updatedAt || row.order.updatedAt,
    createdAt: row.createdAt || row.order.createdAt,
  } as TodoOrder & Record<string, unknown>;
}

function taxRefundTodoHref(order: TodoOrder & Record<string, unknown>, extra: Record<string, string> = {}) {
  return orderHref("/tax-refund", order, {
    keyword: nonEmpty(order.customsDeclarationId || order.id || order.orderNo),
    ...extra,
  });
}

export async function listTaxRefundTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "taxRefund") || !(isAdmin(actor) || isSalesperson(actor) || isFinance(actor))) return [];
  const rows = await prisma.customsDeclaration.findMany({
    where: {
      deletedAt: null,
      taxArchived: false,
      taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES },
      order: { is: { deletedAt: null, ...orderAccessWhere(actor) } },
    },
    include: { order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } } },
    orderBy: [{ updatedAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  const todos: WorkbenchTodo[] = [];
  const owner = roleOwner(context, "FINANCE");
  const refreshedById = new Map(await Promise.all(rows.map(async (row) => [
    row.id,
    needsTaxRefundCompletenessRefresh(row)
      ? await refreshTaxRefundCompletenessForCustomsDeclaration(row.id)
      : null,
  ] as const)));
  for (const row of rows) {
    const refreshed = refreshedById.get(row.id) || null;
    const order = {
      ...taxRefundTodoOrderFromDeclaration(row),
      ...(refreshed ? { taxRefundCompleteness: refreshed } : {}),
    };
    const completeness = refreshed || cachedTaxRefundCompleteness(order);
    const total = Number(completeness.total || 0);
    const completed = Number(completeness.completed || 0);
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const status = taxRefundStatusFromCompleteness((order as Record<string, unknown>).taxRefundStatus, completeness);
    if (total > 0 && completed < total) {
      todos.push(todoForOrder({
        type: "TAX_REFUND_INCOMPLETE",
        title: `退税资料完整度不足 100%（${percent}%）`,
        module: "退税资料",
        order,
        context,
        href: taxRefundTodoHref(order),
        owner,
        updatedAt: order.updatedAt,
      }));
      todos.push(...missingTaxRefundTodos(context, order, normalizedMissingLabels(completeness.missingLabels)));
    } else if (total > 0 && status !== "SUBMITTED" && !order.taxSubmittedAt && !order.taxRefundArchivedAt) {
      todos.push(todoForOrder({
        type: "TAX_REFUND_READY_NOT_ARCHIVED",
        title: "已满足退税条件但未归档",
        module: "退税资料",
        order,
        context,
        dueAt: order.taxRefundCompletenessUpdatedAt || order.updatedAt,
        href: taxRefundTodoHref(order, {
          status: "READY",
          action: "submitTaxArchive",
        }),
        owner: taxRefundArchiveOwner(context, order),
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
  for (const order of rows) {
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
    if (summary.commissionCanSettle && !isCommissionSettled(order)) {
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
    if (hasProfitException) {
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
    if (row.isSoonArriving || row.isEtaOverdue) {
      todos.push(todoForOrder({
        id: `eta-arrival-${row.id}`,
        type: "ETA_ARRIVAL_ALERT",
        title: row.isEtaOverdue ? "ETA 已过期" : "ETA 即将到港",
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
