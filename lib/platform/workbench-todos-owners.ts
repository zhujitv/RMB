import { LEGACY_LOGISTICS_OPERATOR_ROLE, LOGISTICS_OPERATOR_ROLE, customerShortName, nonEmpty } from "./shared";
import { addDays, startOfChinaDay } from "./workbench-todo-rules";
import { uniqueCompanyKeys, uniqueIds } from "./workbench-todos-owner-mappings";
import type { ActorLike, TodoOrder, TodoOwner, TodoSupplier, TodoUser, WorkbenchTodoContext, WorkbenchTodoOwnerRole } from "./workbench-todos-types";

export * from "./workbench-todos-owner-mappings";

export function actorRole(actor: ActorLike) {
  return nonEmpty(actor?.role);
}

export function actorId(actor: ActorLike) {
  return nonEmpty(actor?.id);
}

export function actorSupplierId(actor: ActorLike) {
  return nonEmpty(actor?.supplierId);
}

export function isAdmin(actor: ActorLike) {
  return actorRole(actor) === "管理员";
}

export function isSalesperson(actor: ActorLike) {
  return actorRole(actor) === "业务员";
}

export function isFinance(actor: ActorLike) {
  return actorRole(actor) === "财务";
}

export function isFinanceOperator(actor: ActorLike) {
  return isAdmin(actor) || isFinance(actor);
}

export function isLogisticsOperator(actor: ActorLike) {
  return [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actorRole(actor));
}

export function isLogisticsSupplier(actor: ActorLike) {
  return actorRole(actor) === LOGISTICS_OPERATOR_ROLE;
}

export function isPurchase(actor: ActorLike) {
  return actorRole(actor) === "采购";
}

export function endOfChinaDay(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  const start = startOfChinaDay(date);
  return new Date(addDays(start, 1).getTime() - 1);
}

export function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function orderCustomerShortName(order: TodoOrder) {
  return customerShortName(order.customer) || nonEmpty(order.customerNameSnapshot);
}

export function orderOwnerName(order: TodoOrder) {
  return nonEmpty(order.salesperson?.name) || "未分配";
}

export function userOwner(user: TodoUser | null | undefined, fallbackName: string, ownerRole: WorkbenchTodoOwnerRole): TodoOwner {
  return {
    ownerUserId: nonEmpty(user?.id) || null,
    ownerName: nonEmpty(user?.name) || fallbackName,
    ownerRole,
    ownerUserIds: uniqueIds([user?.id]),
  };
}

export function roleOwner(context: WorkbenchTodoContext, role: WorkbenchTodoOwnerRole): TodoOwner {
  if (role === "FINANCE") {
    const user = context.financeUsers[0];
    return {
      ownerUserId: nonEmpty(user?.id) || null,
      ownerName: nonEmpty(user?.name) || "财务",
      ownerRole: "FINANCE",
      ownerUserIds: uniqueIds(context.financeUsers.map((item) => item.id)),
    };
  }
  if (role === "PURCHASE") {
    const user = context.purchaseUsers[0];
    return {
      ownerUserId: nonEmpty(user?.id) || null,
      ownerName: nonEmpty(user?.name) || "采购",
      ownerRole: "PURCHASE",
      ownerUserIds: uniqueIds(context.purchaseUsers.map((item) => item.id)),
    };
  }
  const admin = context.users.find((user) => user.role === "管理员");
  return {
    ownerUserId: nonEmpty(admin?.id) || null,
    ownerName: nonEmpty(admin?.name) || "管理员",
    ownerRole: "ADMIN",
    ownerUserIds: uniqueIds(context.adminUserIds),
  };
}

export function ownerFromUsers(ownerUsers: TodoUser[], fallbackName: string, ownerRole: WorkbenchTodoOwnerRole): TodoOwner {
  const primaryUser = ownerUsers[0];
  const ownerUserIds = uniqueIds(ownerUsers.map((user) => user.id));
  const primaryRole = primaryUser?.role === "管理员" ? "ADMIN" : "FINANCE";
  return {
    ownerUserId: nonEmpty(primaryUser?.id) || null,
    ownerName: ownerUsers.length > 1
      ? `${nonEmpty(primaryUser?.name) || fallbackName}等${ownerUsers.length}人`
      : nonEmpty(primaryUser?.name) || fallbackName,
    ownerRole: primaryUser ? primaryRole : ownerRole,
    ownerUserIds,
  };
}

export function taxRefundArchiveCompanyKeysForOrder(context: WorkbenchTodoContext, order: TodoOrder) {
  const input = order as TodoOrder & Record<string, unknown>;
  return uniqueCompanyKeys([
    input.companyId,
    input.company_id,
    input.companyCode,
    input.companyKey,
    input.companyName,
    input.companyNameZh,
    input.companyNameSnapshot,
    input.ownerCompanyId,
    input.ownerCompanyName,
    input.businessCompanyId,
    input.businessCompanyName,
    ...context.systemCompanyKeys,
  ]);
}

export function taxRefundArchiveOwner(context: WorkbenchTodoContext, order?: TodoOrder): TodoOwner {
  const companyKeys = order ? taxRefundArchiveCompanyKeysForOrder(context, order) : context.systemCompanyKeys;
  for (const companyKey of companyKeys) {
    const companyOwnerUsers = context.taxRefundArchiveCompanyOwnerUsersByKey.get(companyKey) || [];
    if (companyOwnerUsers.length) return ownerFromUsers(companyOwnerUsers, "财务", "FINANCE");
  }
  const configuredUsers = context.taxRefundArchiveConfiguredOwnerUsers;
  const ownerUsers = configuredUsers.length ? configuredUsers : context.taxRefundArchiveFinanceUsers;
  return ownerFromUsers(ownerUsers, "财务", "FINANCE");
}

export function salespersonOwner(order: TodoOrder): TodoOwner {
  const ownerUserId = nonEmpty(order.salesperson?.id) || nonEmpty(order.salespersonUserId) || nonEmpty(order.customer?.salespersonUserId) || null;
  return {
    ownerUserId,
    ownerName: orderOwnerName(order),
    ownerRole: "SALESPERSON",
    ownerUserIds: uniqueIds([ownerUserId]),
  };
}

export function supplierOwner(context: WorkbenchTodoContext, supplier: TodoSupplier | null | undefined, ownerRole: "LOGISTICS_SUPPLIER" | "PRODUCT_SUPPLIER", fallbackName: string): TodoOwner {
  const supplierId = nonEmpty(supplier?.id);
  const operatorUsers = [
    ...(supplier?.operatorUsers || []),
    ...(supplierId ? context.usersBySupplierId.get(supplierId) || [] : []),
  ].filter((user, index, arr) => user.id && arr.findIndex((item) => item.id === user.id) === index);
  const primaryUser = operatorUsers[0];
  return {
    ownerUserId: nonEmpty(primaryUser?.id) || null,
    ownerName: nonEmpty(supplier?.supplierName) || fallbackName,
    ownerRole,
    ownerUserIds: uniqueIds(operatorUsers.map((user) => user.id)),
  };
}

export function logisticsOwnerForOrder(context: WorkbenchTodoContext, order: TodoOrder) {
  const assigned = (order.logisticsSuppliers || []).find((row) => row?.supplier?.id || row?.supplierId);
  if (assigned?.supplier) {
    return supplierOwner(context, assigned.supplier, "LOGISTICS_SUPPLIER", "物流供应商");
  }
  return salespersonOwner(order);
}

export function visibleUserIds(context: WorkbenchTodoContext, order: TodoOrder, owner?: TodoOwner | null) {
  return uniqueIds([
    ...context.adminUserIds,
    ...(owner?.ownerUserIds || []),
    ...(owner?.visibleToUserIds || []),
    order.salesperson?.id,
    order.salespersonUserId,
    order.customer?.salespersonUserId,
    context.actorUserId,
  ]);
}
