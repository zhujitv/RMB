import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { orderAccessWhere } from "./order-access";
import { canRead } from "./shared-access";
import {
  addDays,
  startOfChinaDay,
  summarizeWorkbenchTodos,
  todoPriorityFromDueAt,
} from "./workbench-todo-rules";
import type { WorkbenchTodoPriority, WorkbenchTodoSummary } from "./workbench-todo-rules";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  FACTORY_SUPPLIER_COST_TYPES,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  PRODUCT_SUPPLIER_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  cachedTaxRefundCompleteness,
  customerShortName,
  getCommissionFormulaSettings,
  includeOrderRelations,
  isLogisticsCostType,
  isProductSupplierOperatorRole,
  isProductSupplierType,
  listShipsgoControlTowerTrackings,
  needsTaxRefundCompletenessRefresh,
  nonEmpty,
  refreshTaxRefundCompleteness,
  summarizeOrder,
  taxRefundStatusFromCompleteness,
  validCost,
} from "./shared";

export type { WorkbenchTodoPriority, WorkbenchTodoSummary } from "./workbench-todo-rules";
export type WorkbenchTodoStatus = "pending" | "completed";
export type WorkbenchTodo = {
  id: string;
  type: string;
  title: string;
  module: string;
  orderId?: string;
  orderNo?: string;
  customerShortName?: string;
  priority: WorkbenchTodoPriority;
  status: WorkbenchTodoStatus;
  dueAt?: string | null;
  ownerName?: string;
  action: {
    label: string;
    href: string;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
};
type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

type TodoOrder = {
  id: string;
  orderNo: string;
  customerNameSnapshot?: string | null;
  dueDate?: Date | string | null;
  expectedShipmentDate?: Date | string | null;
  expectedArrivalDate?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  customer?: { shortName?: string | null; salespersonUserId?: string | null } | null;
  salesperson?: { name?: string | null } | null;
};

const TODO_LIMIT_PER_SOURCE = 80;
const PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE = ["已完成", "已关闭"];
const LOGISTICS_INVOICE_DONE_STATUSES = ["已上传发票", "已确认", "已确认发票"];
const LOGISTICS_INVOICE_REVIEW_STATUSES = ["已上传发票", "部分上传发票", "部分已确认"];
const LOGISTICS_PAYMENT_READY_INVOICE_STATUSES = ["已上传发票", "已确认", "已确认发票"];
const LOGISTICS_PAYMENT_DONE_STATUSES = ["已付款"];
const NEGATIVE_PROFIT_THRESHOLD = 0;
const PROFIT_COST_REVIEW_STATUSES = ["生产中", "已发货", "部分收款", "已收齐", "多收款"];
const PROFIT_COST_REQUIRED_STATUSES = ["已发货", "部分收款", "已收齐", "多收款"];

type TodoCost = {
  id: string;
  order: TodoOrder;
  supplier?: { supplierName?: string | null; supplierType?: string | null } | null;
  supplierNameSnapshot?: string | null;
  vendorName?: string | null;
  costType?: string | null;
  sourceType?: string | null;
  paymentStatus?: string | null;
  paid?: boolean | null;
  paidAt?: Date | string | null;
  paymentDate?: Date | string | null;
  paymentVoucherUrl?: string | null;
  paymentVoucherStorageKey?: string | null;
  paymentVoucherUploadedAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

type TodoPayment = {
  id: string;
  order: TodoOrder;
  paymentDate?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

type TodoLogisticsBill = {
  id: string;
  order: TodoOrder;
  supplier?: { supplierName?: string | null } | null;
  billOfLadingNo?: string | null;
  submittedAt?: Date | string | null;
  reviewedAt?: Date | string | null;
  paymentDate?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

type ProfitOrder = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;

function actorRole(actor: ActorLike) {
  return nonEmpty(actor?.role);
}

function actorId(actor: ActorLike) {
  return nonEmpty(actor?.id);
}

function actorSupplierId(actor: ActorLike) {
  return nonEmpty(actor?.supplierId);
}

function isAdmin(actor: ActorLike) {
  return actorRole(actor) === "管理员";
}

function isSalesperson(actor: ActorLike) {
  return actorRole(actor) === "业务员";
}

function isFinance(actor: ActorLike) {
  return actorRole(actor) === "财务";
}

function isFinanceOperator(actor: ActorLike) {
  return isAdmin(actor) || isFinance(actor);
}

function isLogisticsOperator(actor: ActorLike) {
  return [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actorRole(actor));
}

function isLogisticsSupplier(actor: ActorLike) {
  return actorRole(actor) === LOGISTICS_OPERATOR_ROLE;
}

function isPurchase(actor: ActorLike) {
  return actorRole(actor) === "采购";
}

function endOfChinaDay(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const start = startOfChinaDay(date);
  return new Date(addDays(start, 1).getTime() - 1);
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function orderCustomerShortName(order: TodoOrder) {
  return customerShortName(order.customer) || nonEmpty(order.customerNameSnapshot);
}

function orderOwnerName(order: TodoOrder) {
  return nonEmpty(order.salesperson?.name) || "未分配";
}

function orderHref(modulePath: string, order: Pick<TodoOrder, "id" | "orderNo">, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ orderId: order.id, keyword: order.orderNo, ...extra });
  return `${modulePath}?${params.toString()}`;
}

function todoForOrder(input: {
  id?: string;
  type: string;
  title: string;
  module: string;
  order: TodoOrder;
  dueAt?: Date | string | null;
  href: string;
  ownerName?: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): WorkbenchTodo {
  const dueAt = iso(endOfChinaDay(input.dueAt || null));
  return {
    id: input.id || `${input.type.toLowerCase()}-${input.order.id}`,
    type: input.type,
    title: input.title,
    module: input.module,
    orderId: input.order.id,
    orderNo: input.order.orderNo,
    customerShortName: orderCustomerShortName(input.order),
    priority: todoPriorityFromDueAt(dueAt),
    status: "pending",
    dueAt,
    ownerName: input.ownerName || orderOwnerName(input.order),
    action: { label: "处理", href: input.href },
    createdAt: iso(input.createdAt || input.order.createdAt),
    updatedAt: iso(input.updatedAt || input.order.updatedAt),
  };
}

function supplierNameForCost(cost: TodoCost) {
  return nonEmpty(cost.supplier?.supplierName) || nonEmpty(cost.supplierNameSnapshot) || nonEmpty(cost.vendorName) || "产品供应商";
}

function productSupplierPaymentCostWhere(): Prisma.OrderCostWhereInput {
  return {
    sourceType: { not: "LOGISTICS_EXPENSE" },
    OR: [
      { costType: { in: FACTORY_SUPPLIER_COST_TYPES } },
      { supplier: { is: { supplierType: { in: PRODUCT_SUPPLIER_TYPES } } } },
    ],
  };
}

function isProductSupplierPaymentCost(cost: {
  costType?: string | null;
  sourceType?: string | null;
  supplier?: { supplierType?: string | null } | null;
}) {
  if (cost.sourceType === "LOGISTICS_EXPENSE" || isLogisticsCostType(cost.costType || "")) return false;
  return FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType || "") || isProductSupplierType(cost.supplier?.supplierType);
}

function paidCostWhere(): Prisma.OrderCostWhereInput {
  return {
    OR: [
      { paid: true },
      { paymentStatus: { in: ["已支付", "部分支付"] } },
    ],
  };
}

function todoForCost(input: {
  type: string;
  title: string;
  module: string;
  cost: TodoCost;
  dueAt?: Date | string | null;
  href?: string;
  ownerName?: string;
}) {
  return todoForOrder({
    id: `${input.type.toLowerCase()}-${input.cost.id}`,
    type: input.type,
    title: input.title,
    module: input.module,
    order: input.cost.order,
    dueAt: input.dueAt,
    href: input.href || orderHref("/costs", input.cost.order, {
      costId: input.cost.id,
      keyword: input.cost.order.orderNo,
    }),
    ownerName: input.ownerName || supplierNameForCost(input.cost),
    createdAt: input.cost.createdAt,
    updatedAt: input.cost.updatedAt,
  });
}

function todoForPayment(input: {
  type: string;
  title: string;
  payment: TodoPayment;
}) {
  return todoForOrder({
    id: `${input.type.toLowerCase()}-${input.payment.id}`,
    type: input.type,
    title: input.title,
    module: "收款管理",
    order: input.payment.order,
    dueAt: input.payment.paymentDate || input.payment.createdAt,
    href: orderHref("/payments", input.payment.order, {
      paymentId: input.payment.id,
      keyword: input.payment.order.orderNo,
    }),
    ownerName: "财务/管理员",
    createdAt: input.payment.createdAt,
    updatedAt: input.payment.updatedAt,
  });
}

function todoForLogisticsBill(input: {
  type: string;
  title: string;
  bill: TodoLogisticsBill;
  dueAt?: Date | string | null;
  ownerName?: string;
}) {
  return todoForOrder({
    id: `${input.type.toLowerCase()}-${input.bill.id}`,
    type: input.type,
    title: input.title,
    module: "物流费用",
    order: input.bill.order,
    dueAt: input.dueAt || input.bill.updatedAt,
    href: orderHref("/logistics-fees", input.bill.order, {
      billId: input.bill.id,
      keyword: input.bill.billOfLadingNo || input.bill.order.orderNo,
    }),
    ownerName: input.ownerName || input.bill.supplier?.supplierName || "财务/管理员",
    createdAt: input.bill.createdAt,
    updatedAt: input.bill.updatedAt,
  });
}

function activeOrderBaseWhere(actor: ActorLike): Prisma.ReceivableOrderWhereInput {
  const role = actorRole(actor);
  const supplierId = actorSupplierId(actor);
  const filters: Prisma.ReceivableOrderWhereInput[] = [
    { deletedAt: null },
    { status: { notIn: ["已关闭", "已取消"] } },
  ];
  if (role === "业务员") filters.push(orderAccessWhere(actor));
  if (role === LOGISTICS_OPERATOR_ROLE) {
    filters.push(supplierId ? { logisticsSuppliers: { some: { supplierId } } } : { id: "__no_supplier_bound__" });
  }
  return { AND: filters };
}

function logisticsBillAccessWhere(actor: ActorLike): Prisma.LogisticsBillWhereInput {
  const role = actorRole(actor);
  const supplierId = actorSupplierId(actor);
  if (role === "管理员") return {};
  if (role === "财务") return { auditStatus: "审核通过" };
  if (role === "业务员") return { order: { is: { customer: { is: { salespersonUserId: actorId(actor) } } } } };
  if (role === LOGISTICS_OPERATOR_ROLE) return supplierId ? { supplierId } : { id: "__no_supplier_bound__" };
  if (role === LEGACY_LOGISTICS_OPERATOR_ROLE) return {};
  return { id: "__no_logistics_bill_access__" };
}

function shipsgoTrackingAccessWhere(actor: ActorLike): Prisma.ShipsgoTrackingWhereInput {
  const role = actorRole(actor);
  const supplierId = actorSupplierId(actor);
  if (role === "管理员") return {};
  if (role === "业务员") return { order: { is: { customer: { is: { salespersonUserId: actorId(actor) } } } } };
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role) && supplierId) {
    return { order: { is: { logisticsSuppliers: { some: { supplierId } } } } };
  }
  if (role === LEGACY_LOGISTICS_OPERATOR_ROLE) return {};
  return { id: "__no_shipsgo_tracking_access__" };
}

async function listOrderTodos(actor: ActorLike) {
  if (!canRead(actor, "orders") || !(isAdmin(actor) || isSalesperson(actor) || isPurchase(actor))) return [];
  const [draftOrders, purchasePendingOrders] = await Promise.all([
    prisma.receivableOrder.findMany({
      where: {
        deletedAt: null,
        status: { in: ["草稿", "待审核"] },
        AND: [orderAccessWhere(actor)],
      },
      include: { customer: true, salesperson: { select: { name: true } } },
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
      include: { customer: true, salesperson: { select: { name: true } } },
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
      dueAt: order.dueDate || order.expectedShipmentDate,
      href: orderHref("/orders", order),
    })),
    ...purchasePendingOrders.map((order) => todoForOrder({
      type: "PURCHASE_ORDER_PENDING",
      title: "采购订单待下达",
      module: "应收订单",
      order,
      dueAt: order.expectedShipmentDate || order.dueDate,
      href: orderHref("/orders", order),
    })),
  ];
}

async function listDomesticLogisticsTodos(actor: ActorLike) {
  if (!canRead(actor, "domesticLogistics") || !(isAdmin(actor) || isSalesperson(actor) || isLogisticsOperator(actor))) return [];
  const where = activeOrderBaseWhere(actor);
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: {
      customer: true,
      salesperson: { select: { name: true } },
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
    if (!order.domesticLogisticsInfos.length) {
      todos.push(todoForOrder({
        type: "LOGISTICS_INFO_MISSING",
        title: "物流信息待录入",
        module: "物流信息",
        order,
        dueAt: order.expectedShipmentDate || order.dueDate,
        href: orderHref("/domestic-logistics", order),
      }));
    }
    const hasBillNo = Boolean(nonEmpty(order.blNo) || order.logisticsBills.some((bill) => nonEmpty(bill.billOfLadingNo)));
    if (!hasBillNo) {
      todos.push(todoForOrder({
        type: "BILL_OF_LADING_MISSING",
        title: "提单号缺失",
        module: "物流信息",
        order,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/domestic-logistics", order),
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
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/domestic-logistics", order),
      }));
    }
    if (!order.logisticsExpenses.length && (isAdmin(actor) || isSalesperson(actor) || isLogisticsSupplier(actor))) {
      todos.push(todoForOrder({
        type: "LOGISTICS_FEE_ENTRY",
        title: "物流费用待录入",
        module: "物流费用",
        order,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/logistics-fees", order),
      }));
    }
  }
  return todos;
}

async function listLogisticsFeeTodos(actor: ActorLike) {
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
        order: { include: { customer: true, salesperson: { select: { name: true } } } },
        supplier: { select: { supplierName: true } },
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
        order: { include: { customer: true, salesperson: { select: { name: true } } } },
        supplier: { select: { supplierName: true } },
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
            order: { include: { customer: true, salesperson: { select: { name: true } } } },
            supplier: { select: { supplierName: true } },
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
            order: { include: { customer: true, salesperson: { select: { name: true } } } },
            supplier: { select: { supplierName: true } },
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
      dueAt: bill.submittedAt || bill.updatedAt,
      ownerName: isLogisticsSupplier(actor) ? (bill.supplier?.supplierName || "物流供应商") : "财务/管理员",
    })),
    ...invoiceBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_INVOICE_UPLOAD",
      title: "物流发票待上传",
      bill,
      dueAt: bill.reviewedAt || bill.updatedAt,
      ownerName: bill.supplier?.supplierName || "物流供应商",
    })),
    ...invoiceReviewBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_INVOICE_REVIEW",
      title: "发票待审核",
      bill,
      dueAt: bill.updatedAt,
      ownerName: "财务/管理员",
    })),
    ...paymentBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_PAYMENT_REGISTER",
      title: "物流付款待登记",
      bill,
      dueAt: bill.paymentDate || bill.updatedAt,
      ownerName: "财务/管理员",
    })),
  ];
}

async function listSupplierDocumentTodos(actor: ActorLike) {
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
      order: { include: { customer: true, salesperson: { select: { name: true } } } },
      supplier: { select: { supplierName: true } },
    },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  return rows.map((row) => todoForOrder({
    type: "SUPPLIER_DOCUMENT_RETURN",
    title: "供应商资料待回传",
    module: "资料回传",
    order: row.order,
    dueAt: row.dueDate,
    href: orderHref("/supplier-documents", row.order, {
      requestId: row.id,
      keyword: row.order.orderNo,
    }),
    ownerName: productSupplier ? "当前供应商" : (row.supplier?.supplierName || "产品供应商"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

async function listCustomerPaymentTodos(actor: ActorLike) {
  if (!canRead(actor, "payments") || !isFinanceOperator(actor)) return [];
  const rows = await prisma.payment.findMany({
    where: {
      deletedAt: null,
      status: "待确认",
      order: { is: orderAccessWhere(actor) },
    },
    include: {
      order: { include: { customer: true, salesperson: { select: { name: true } } } },
    },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  return rows.map((payment) => todoForPayment({
    type: "CUSTOMER_PAYMENT_CONFIRMATION",
    title: "客户回款待确认",
    payment,
  }));
}

async function listFactoryPaymentTodos(actor: ActorLike) {
  if (!canRead(actor, "costs") || !isFinanceOperator(actor)) return [];
  const baseWhere = productSupplierPaymentCostWhere();
  const include = {
    order: { include: { customer: true, salesperson: { select: { name: true } } } },
    supplier: { select: { supplierName: true, supplierType: true } },
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
          paidCostWhere(),
          { paymentVoucherStorageKey: null },
          { paymentVoucherUrl: null },
        ],
      },
      include,
      orderBy: [{ paidAt: "asc" }, { updatedAt: "asc" }],
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
    dueAt: cost.updatedAt,
  })));
  missingVoucherCosts.forEach((cost) => addCostTodo(cost, () => todoForCost({
    type: "PAYMENT_VOUCHER_UPLOAD",
    title: "付款凭证待上传",
    module: "成本管理",
    cost,
    dueAt: cost.paidAt || cost.paymentDate || cost.updatedAt,
  })));
  unpaidCosts.forEach((cost) => addCostTodo(cost, () => todoForCost({
    type: "FACTORY_PAYMENT_REGISTER",
    title: "工厂付款待登记",
    module: "成本管理",
    cost,
    dueAt: cost.paymentDate || cost.order.expectedShipmentDate || cost.order.dueDate,
  })));
  return todos;
}

function missingTaxRefundTodos(order: TodoOrder, missingLabels: string[] = []) {
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
      href: orderHref("/tax-refund", order),
      updatedAt: order.updatedAt,
    }));
}

function normalizedMissingLabels(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => nonEmpty(item)).filter(Boolean)
    : [];
}

async function listTaxRefundTodos(actor: ActorLike) {
  if (!canRead(actor, "taxRefund") || !(isAdmin(actor) || isSalesperson(actor) || isFinance(actor))) return [];
  const rows = await prisma.receivableOrder.findMany({
    where: {
      deletedAt: null,
      taxArchived: false,
      taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES },
      AND: [orderAccessWhere(actor)],
    },
    include: { customer: true, salesperson: { select: { name: true } } },
    orderBy: [{ updatedAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  const refreshedEntries = await Promise.all(
    rows
      .filter(needsTaxRefundCompletenessRefresh)
      .map(async (order) => [order.id, await refreshTaxRefundCompleteness(order.id)] as const),
  );
  const refreshedById = new Map(refreshedEntries.filter(([, completeness]) => completeness));
  const todos: WorkbenchTodo[] = [];
  for (const order of rows) {
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
        href: orderHref("/tax-refund", order),
        updatedAt: order.updatedAt,
      }));
      todos.push(...missingTaxRefundTodos(orderWithCompleteness, normalizedMissingLabels(completeness.missingLabels)));
    } else if (total > 0 && status !== "SUBMITTED") {
      todos.push(todoForOrder({
        type: "TAX_REFUND_READY_NOT_ARCHIVED",
        title: "已满足退税条件但未归档",
        module: "退税资料",
        order: orderWithCompleteness,
        href: orderHref("/tax-refund", order),
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

async function listProfitTodos(actor: ActorLike) {
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
  for (const order of rows) {
    const summary = summarizeOrder(order, commissionFormulaSettings);
    const validCosts = (order.costs || []).filter(validCost);
    if (shouldCreateProfitCostIncompleteTodo(order, validCosts, summary)) {
      todos.push(todoForOrder({
        type: "PROFIT_COST_INCOMPLETE",
        title: "成本未完整录入",
        module: "利润分析",
        order,
        dueAt: order.expectedShipmentDate || profitOrderDueDate(order),
        href: orderHref("/profit", order),
        updatedAt: order.updatedAt,
      }));
    }
    if (summary.commissionCanSettle && !isCommissionSettled(order)) {
      todos.push(todoForOrder({
        type: "COMMISSION_SETTLEMENT",
        title: "提成待结算",
        module: "利润分析",
        order,
        dueAt: order.commissionSettledAt || order.updatedAt,
        href: orderHref("/profit", order),
        ownerName: order.salesperson?.name || "财务/管理员",
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
        dueAt: order.updatedAt,
        href: orderHref("/profit", order),
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

async function listOceanTrackingTodos(actor: ActorLike) {
  if (!canRead(actor, "domesticLogistics") || !(isAdmin(actor) || isSalesperson(actor) || isLogisticsOperator(actor))) return [];
  const result = await listShipsgoControlTowerTrackings(new URLSearchParams(), actor);
  const todos: WorkbenchTodo[] = [];
  for (const row of result.rows || []) {
    const order = trackingTodoOrder(row);
    if (!order) continue;
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
        dueAt: row.eta || row.predictedDischargeDate || row.dateOfDischarge,
        href,
        ownerName: "物流/业务",
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
        dueAt: row.isSyncFailed ? new Date() : (row.lastSyncTime || row.lastSyncedAt || row.updatedAt),
        href,
        ownerName: "物流/业务",
        updatedAt: row.updatedAt,
      }));
    }
  }
  return todos;
}

async function completedTodayCount(actor: ActorLike, now = new Date()) {
  const today = startOfChinaDay(now);
  const tomorrow = addDays(today, 1);
  const counts: Promise<number>[] = [];
  const productCostWhere = productSupplierPaymentCostWhere();
  if (canRead(actor, "payments") && isFinanceOperator(actor)) {
    counts.push(prisma.payment.count({
      where: {
        deletedAt: null,
        status: "已到账",
        updatedAt: { gte: today, lt: tomorrow },
        order: { is: orderAccessWhere(actor) },
      },
    }));
  }
  if (canRead(actor, "costs") && isFinanceOperator(actor)) {
    counts.push(prisma.orderCost.count({
      where: {
        deletedAt: null,
        paymentStatus: { not: "已取消" },
        AND: [
          productCostWhere,
          {
            OR: [
              { paidAt: { gte: today, lt: tomorrow } },
              { paymentVoucherUploadedAt: { gte: today, lt: tomorrow } },
              { updatedAt: { gte: today, lt: tomorrow }, ...paidCostWhere() },
            ],
          },
        ],
      },
    }));
  }
  if (canRead(actor, "supplierDocuments") && (isAdmin(actor) || isProductSupplierOperatorRole(actorRole(actor)))) {
    counts.push(prisma.supplierDocumentRequest.count({
      where: {
        deletedAt: null,
        status: "已完成",
        updatedAt: { gte: today, lt: tomorrow },
        ...(isProductSupplierOperatorRole(actorRole(actor))
          ? { supplierId: actorSupplierId(actor) || "__no_supplier_bound__" }
          : {}),
      },
    }));
  }
  if ((canRead(actor, "domesticLogistics") || canRead(actor, "costs")) && (isAdmin(actor) || isSalesperson(actor) || isFinance(actor) || isLogisticsOperator(actor))) {
    counts.push(prisma.logisticsBill.count({
      where: {
        deletedAt: null,
        OR: [
          { auditStatus: "审核通过", reviewedAt: { gte: today, lt: tomorrow } },
          { invoiceStatus: { in: LOGISTICS_INVOICE_DONE_STATUSES }, updatedAt: { gte: today, lt: tomorrow } },
        ],
        ...logisticsBillAccessWhere(actor),
      },
    }));
  }
  if (canRead(actor, "domesticLogistics") && isFinanceOperator(actor)) {
    counts.push(prisma.logisticsBill.count({
      where: {
        deletedAt: null,
        auditStatus: "审核通过",
        paymentStatus: "已付款",
        updatedAt: { gte: today, lt: tomorrow },
        ...logisticsBillAccessWhere(actor),
      },
    }));
  }
  if (canRead(actor, "taxRefund") && (isAdmin(actor) || isSalesperson(actor) || isFinance(actor))) {
    counts.push(prisma.receivableOrder.count({
      where: {
        deletedAt: null,
        taxArchived: true,
        taxRefundArchivedAt: { gte: today, lt: tomorrow },
        AND: [orderAccessWhere(actor)],
      },
    }));
  }
  if (canRead(actor, "commissions") && isFinanceOperator(actor)) {
    counts.push(prisma.receivableOrder.count({
      where: {
        deletedAt: null,
        commissionStatus: { in: ["已结算", "SETTLED"] },
        commissionSettledAt: { gte: today, lt: tomorrow },
        AND: [orderAccessWhere(actor)],
      },
    }));
  }
  if (canRead(actor, "domesticLogistics") && (isAdmin(actor) || isSalesperson(actor) || isLogisticsOperator(actor))) {
    counts.push(prisma.shipsgoTracking.count({
      where: {
        deletedAt: null,
        provider: "SHIPSGO",
        mode: "OCEAN",
        lastSyncTime: { gte: today, lt: tomorrow },
        ...shipsgoTrackingAccessWhere(actor),
      },
    }));
  }
  const values = await Promise.all(counts);
  return values.reduce((sum, value) => sum + value, 0);
}

function priorityRank(priority: WorkbenchTodoPriority) {
  return priority === "urgent" ? 0 : priority === "important" ? 1 : 2;
}

function sortWorkbenchTodos(a: WorkbenchTodo, b: WorkbenchTodo) {
  const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDiff) return priorityDiff;
  const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (dueA !== dueB) return dueA - dueB;
  const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return updatedB - updatedA;
}

function uniqueTodos(todos: WorkbenchTodo[]) {
  const seen = new Set<string>();
  return todos.filter((todo) => {
    if (seen.has(todo.id)) return false;
    seen.add(todo.id);
    return true;
  });
}

export async function listWorkbenchTodos(actor: ActorLike) {
  const [
    orderTodos,
    domesticLogisticsTodos,
    logisticsFeeTodos,
    supplierDocumentTodos,
    customerPaymentTodos,
    factoryPaymentTodos,
    taxRefundTodos,
    profitTodos,
    oceanTrackingTodos,
    completed,
  ] = await Promise.all([
    listOrderTodos(actor),
    listDomesticLogisticsTodos(actor),
    listLogisticsFeeTodos(actor),
    listSupplierDocumentTodos(actor),
    listCustomerPaymentTodos(actor),
    listFactoryPaymentTodos(actor),
    listTaxRefundTodos(actor),
    listProfitTodos(actor),
    listOceanTrackingTodos(actor),
    completedTodayCount(actor),
  ]);
  const todos = uniqueTodos([
    ...orderTodos,
    ...domesticLogisticsTodos,
    ...logisticsFeeTodos,
    ...supplierDocumentTodos,
    ...customerPaymentTodos,
    ...factoryPaymentTodos,
    ...taxRefundTodos,
    ...profitTodos,
    ...oceanTrackingTodos,
  ]).sort(sortWorkbenchTodos);
  return {
    todos,
    summary: summarizeWorkbenchTodos(todos, completed),
    generatedAt: new Date().toISOString(),
    sourceTypes: [
      "orders",
      "domesticLogistics",
      "logisticsFees",
      "supplierDocuments",
      "payments",
      "factoryPayments",
      "taxRefund",
      "profit",
      "oceanTracking",
    ],
    supportedDocumentTypes: SUPPLIER_DOCUMENT_TYPES,
  };
}
