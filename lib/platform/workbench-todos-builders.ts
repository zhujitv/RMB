import type { Prisma } from "../generated/prisma/client.js";
import { orderAccessWhere, orderSalespersonOwnershipWhere } from "./order-access";
import { addDays, startOfChinaDay, todoActivationRuleForType, todoPriorityFromDueAt } from "./workbench-todo-rules";
import type { WorkbenchTodoPriority, WorkbenchTodoStatus } from "./workbench-todo-rules";
import { FACTORY_SUPPLIER_COST_TYPES, LEGACY_LOGISTICS_OPERATOR_ROLE, LOGISTICS_GENERATED_COST_SOURCE_TYPES, LOGISTICS_OPERATOR_ROLE, ORDER_COST_STATUS_VOID, PRODUCT_SUPPLIER_TYPES, isLogisticsCostType, isLogisticsGeneratedCostSourceType, isProductSupplierType, nonEmpty } from "./shared";
import type { ActorLike, TodoCost, TodoLogisticsBill, TodoOrder, TodoOwner, TodoPayment, WorkbenchTodo, WorkbenchTodoContext } from "./workbench-todos-types";
import { actorId, actorRole, actorSupplierId, endOfChinaDay, iso, orderCustomerShortName, orderOwnerName, salespersonOwner, supplierOwner, uniqueIds, visibleUserIds } from "./workbench-todos-owners";

export function orderHref(modulePath: string, order: Pick<TodoOrder, "id" | "orderNo">, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ orderId: order.id, keyword: order.orderNo, ...extra });
  return `${modulePath}?${params.toString()}`;
}

export function todoForOrder(input: {
  id?: string;
  type: string;
  title: string;
  module: string;
  order: TodoOrder;
  context?: WorkbenchTodoContext;
  dueAt?: Date | string | null;
  status?: WorkbenchTodoStatus;
  href: string;
  owner?: TodoOwner;
  ownerName?: string;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}): WorkbenchTodo {
  const dueAt = iso(endOfChinaDay(input.dueAt || null));
  const owner = input.owner || {
    ...salespersonOwner(input.order),
    ownerName: input.ownerName || orderOwnerName(input.order),
  };
  const visibleToUserIds = input.context ? visibleUserIds(input.context, input.order, owner) : uniqueIds(owner.ownerUserIds || []);
  const actorUserId = input.context?.actorUserId || "";
  const ownerUserIds = uniqueIds(owner.ownerUserIds || [owner.ownerUserId]);
  const activationRule = todoActivationRuleForType(input.type);
  return {
    id: input.id || `${input.type.toLowerCase()}-${input.order.id}`,
    type: input.type,
    title: input.title,
    module: input.module,
    flowStage: activationRule.flowStage,
    prerequisiteStage: activationRule.prerequisiteStage || null,
    activationCondition: activationRule.activationCondition,
    orderId: input.order.id,
    orderNo: input.order.orderNo,
    customerShortName: orderCustomerShortName(input.order),
    priority: todoPriorityFromDueAt(dueAt),
    status: input.status || "ACTIVE",
    dueAt,
    ownerUserId: owner.ownerUserId || null,
    ownerUserIds,
    ownerName: input.ownerName || owner.ownerName || orderOwnerName(input.order),
    ownerRole: owner.ownerRole,
    visibleToUserIds,
    isMine: Boolean(actorUserId && (owner.ownerUserId === actorUserId || (owner.ownerUserIds || []).includes(actorUserId))),
    action: { label: "处理", href: input.href },
    createdAt: iso(input.createdAt || input.order.createdAt),
    updatedAt: iso(input.updatedAt || input.order.updatedAt),
  };
}

export function supplierNameForCost(cost: TodoCost) {
  return nonEmpty(cost.supplier?.supplierName) || nonEmpty(cost.supplierNameSnapshot) || nonEmpty(cost.vendorName) || "产品供应商";
}

export function productSupplierPaymentCostWhere(): Prisma.OrderCostWhereInput {
  return {
    status: { not: ORDER_COST_STATUS_VOID },
	    sourceType: { notIn: LOGISTICS_GENERATED_COST_SOURCE_TYPES },
    OR: [
      { costType: { in: FACTORY_SUPPLIER_COST_TYPES } },
      { supplier: { is: { supplierType: { in: PRODUCT_SUPPLIER_TYPES } } } },
    ],
  };
}

export function isProductSupplierPaymentCost(cost: {
  costType?: string | null;
  sourceType?: string | null;
  supplier?: { supplierType?: string | null } | null;
}) {
	if (isLogisticsGeneratedCostSourceType(cost.sourceType) || isLogisticsCostType(cost.costType || "")) return false;
  return FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType || "") || isProductSupplierType(cost.supplier?.supplierType);
}

export function paidCostWhere(): Prisma.OrderCostWhereInput {
  return {
    OR: [
      { paid: true },
      { paymentStatus: { in: ["已支付", "部分支付"] } },
    ],
  };
}

export function todoForCost(input: {
  type: string;
  title: string;
  module: string;
  cost: TodoCost;
  context?: WorkbenchTodoContext;
  dueAt?: Date | string | null;
  href?: string;
  owner?: TodoOwner;
  ownerName?: string;
  status?: WorkbenchTodoStatus;
}) {
  return todoForOrder({
    id: `${input.type.toLowerCase()}-${input.cost.id}`,
    type: input.type,
    title: input.title,
    module: input.module,
    order: input.cost.order,
    context: input.context,
    dueAt: input.dueAt,
    href: input.href || orderHref("/costs", input.cost.order, {
      costId: input.cost.id,
      keyword: input.cost.order.orderNo,
    }),
    owner: input.owner,
    ownerName: input.ownerName || supplierNameForCost(input.cost),
    status: input.status,
    createdAt: input.cost.createdAt,
    updatedAt: input.cost.updatedAt,
  });
}

export function todoForPayment(input: {
  type: string;
  title: string;
  payment: TodoPayment;
  context?: WorkbenchTodoContext;
  owner?: TodoOwner;
  status?: WorkbenchTodoStatus;
}) {
  return todoForOrder({
    id: `${input.type.toLowerCase()}-${input.payment.id}`,
    type: input.type,
    title: input.title,
    module: "收款管理",
    order: input.payment.order,
    context: input.context,
    dueAt: input.payment.paymentDate || input.payment.createdAt,
    href: orderHref("/payments", input.payment.order, {
      paymentId: input.payment.id,
      keyword: input.payment.order.orderNo,
    }),
    owner: input.owner,
    ownerName: input.owner?.ownerName || "财务/管理员",
    status: input.status,
    createdAt: input.payment.createdAt,
    updatedAt: input.payment.updatedAt,
  });
}

export function todoForLogisticsBill(input: {
  type: string;
  title: string;
  bill: TodoLogisticsBill;
  context?: WorkbenchTodoContext;
  dueAt?: Date | string | null;
  owner?: TodoOwner;
  ownerName?: string;
  status?: WorkbenchTodoStatus;
}) {
  const owner = input.owner || (input.context ? supplierOwner(input.context, input.bill.supplier, "LOGISTICS_SUPPLIER", "物流供应商") : undefined);
  return todoForOrder({
    id: `${input.type.toLowerCase()}-${input.bill.id}`,
    type: input.type,
    title: input.title,
    module: "物流费用",
    order: input.bill.order,
    context: input.context,
    dueAt: input.dueAt || input.bill.updatedAt,
    href: orderHref("/logistics-fees", input.bill.order, {
      billId: input.bill.id,
      keyword: input.bill.billOfLadingNo || input.bill.order.orderNo,
    }),
    owner,
    ownerName: input.ownerName || owner?.ownerName || input.bill.supplier?.supplierName || "财务/管理员",
    status: input.status,
    createdAt: input.bill.createdAt,
    updatedAt: input.bill.updatedAt,
  });
}

export function activeOrderBaseWhere(actor: ActorLike): Prisma.ReceivableOrderWhereInput {
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

export function logisticsBillAccessWhere(actor: ActorLike): Prisma.LogisticsBillWhereInput {
  const role = actorRole(actor);
  const supplierId = actorSupplierId(actor);
  if (role === "管理员") return {};
  if (role === "财务") return { auditStatus: "审核通过" };
  if (role === "业务员") return { order: { is: orderSalespersonOwnershipWhere(actorId(actor)) } };
  if (role === LOGISTICS_OPERATOR_ROLE) return supplierId ? { supplierId } : { id: "__no_supplier_bound__" };
  if (role === LEGACY_LOGISTICS_OPERATOR_ROLE) return {};
  return { id: "__no_logistics_bill_access__" };
}

export function shipsgoTrackingAccessWhere(actor: ActorLike): Prisma.ShipsgoTrackingWhereInput {
  const role = actorRole(actor);
  const supplierId = actorSupplierId(actor);
  if (role === "管理员") return {};
  if (role === "业务员") return { order: { is: orderSalespersonOwnershipWhere(actorId(actor)) } };
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role) && supplierId) {
    return { order: { is: { logisticsSuppliers: { some: { supplierId } } } } };
  }
  if (role === LEGACY_LOGISTICS_OPERATOR_ROLE) return {};
  return { id: "__no_shipsgo_tracking_access__" };
}

export function priorityRank(priority: WorkbenchTodoPriority) {
  return priority === "urgent" ? 0 : priority === "important" ? 1 : 2;
}

export function sortWorkbenchTodos(a: WorkbenchTodo, b: WorkbenchTodo) {
  const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDiff) return priorityDiff;
  const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  if (dueA !== dueB) return dueA - dueB;
  const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return updatedB - updatedA;
}

export function uniqueTodos(todos: WorkbenchTodo[]) {
  const seen = new Set<string>();
  return todos.filter((todo) => {
    if (seen.has(todo.id)) return false;
    seen.add(todo.id);
    return true;
  });
}
