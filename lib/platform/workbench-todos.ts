import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { orderAccessWhere } from "./order-access";
import { canRead, canWrite } from "./shared-access";
import {
  addDays,
  startOfChinaDay,
  summarizeWorkbenchTodos,
  todoPriorityFromDueAt,
} from "./workbench-todo-rules";
import type { WorkbenchTodoPriority, WorkbenchTodoSummary } from "./workbench-todo-rules";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  COMPANY_PROFILE_SETTING_KEY,
  DEFAULT_COMPANY_PROFILE_SETTINGS,
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
export type WorkbenchTodoOwnerRole = "LOGISTICS_SUPPLIER" | "SALESPERSON" | "ADMIN" | "FINANCE" | "PURCHASE" | "PRODUCT_SUPPLIER";
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
  ownerUserId?: string | null;
  ownerUserIds?: string[];
  ownerName?: string;
  ownerRole?: WorkbenchTodoOwnerRole;
  visibleToUserIds: string[];
  isMine: boolean;
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
  taxRefundCompletenessUpdatedAt?: Date | string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxSubmittedAt?: Date | string | null;
  salespersonUserId?: string | null;
  customer?: { shortName?: string | null; salespersonUserId?: string | null } | null;
  salesperson?: { id?: string | null; name?: string | null; email?: string | null; role?: string | null } | null;
  logisticsSuppliers?: TodoLogisticsSupplierAssignment[] | null;
};

type TodoUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
};

type TodoSupplier = {
  id?: string | null;
  supplierName?: string | null;
  supplierType?: string | null;
  email?: string | null;
  operatorUsers?: TodoUser[] | null;
};

type TodoLogisticsSupplierAssignment = {
  supplierId?: string | null;
  supplier?: TodoSupplier | null;
};

type TodoOwner = {
  ownerUserId?: string | null;
  ownerName?: string | null;
  ownerRole: WorkbenchTodoOwnerRole;
  ownerUserIds?: string[];
  visibleToUserIds?: string[];
};

type WorkbenchTodoContext = {
  actor: ActorLike;
  actorUserId: string;
  users: TodoUser[];
  adminUserIds: string[];
  financeUsers: TodoUser[];
  taxRefundArchiveFinanceUsers: TodoUser[];
  taxRefundArchiveConfiguredOwnerUsers: TodoUser[];
  taxRefundArchiveCompanyOwnerUsersByKey: Map<string, TodoUser[]>;
  systemCompanyKeys: string[];
  purchaseUsers: TodoUser[];
  usersBySupplierId: Map<string, TodoUser[]>;
};

const TODO_LIMIT_PER_SOURCE = 80;
const WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS = [
  "workbench_tax_refund_archive_finance_owner",
  "tax_refund_archive_finance_owner",
  "workbench_default_finance_owner",
];
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
  supplier?: { id?: string | null; supplierName?: string | null; supplierType?: string | null } | null;
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
  supplierId?: string | null;
  supplier?: TodoSupplier | null;
  billOfLadingNo?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
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

function configuredOwnerIdsFromValue(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return uniqueIds(value.map((item) => nonEmpty(item)));
  if (typeof value === "string") {
    return uniqueIds(value.split(/[,，\s]+/).map((item) => nonEmpty(item)));
  }
  if (typeof value !== "object") return [];
  const input = value as Record<string, unknown>;
  return uniqueIds([
    ...configuredOwnerIdsFromValue(input.defaultFinanceUserId),
    ...configuredOwnerIdsFromValue(input.defaultFinanceUserIds),
    ...configuredOwnerIdsFromValue(input.financeUserId),
    ...configuredOwnerIdsFromValue(input.financeUserIds),
    ...configuredOwnerIdsFromValue(input.taxRefundArchiveFinanceUserId),
    ...configuredOwnerIdsFromValue(input.taxRefundArchiveFinanceUserIds),
    ...configuredOwnerIdsFromValue(input.ownerUserId),
    ...configuredOwnerIdsFromValue(input.ownerUserIds),
    ...configuredOwnerIdsFromValue(input.userId),
    ...configuredOwnerIdsFromValue(input.userIds),
    ...configuredOwnerIdsFromValue(input.defaultUserId),
    ...configuredOwnerIdsFromValue(input.defaultUserIds),
  ]);
}

function taxRefundArchiveOwnerIdsFromSetting(value: unknown) {
  return configuredOwnerIdsFromValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ownerCompanyKey(value: unknown) {
  return nonEmpty(value).toLowerCase();
}

function uniqueCompanyKeys(values: unknown[]) {
  return values.map(ownerCompanyKey).filter((value, index, arr) => value && arr.indexOf(value) === index);
}

function companyKeysFromRecord(input: Record<string, unknown>) {
  return uniqueCompanyKeys([
    input.companyId,
    input.company_id,
    input.companyCode,
    input.companyKey,
    input.companyName,
    input.companyNameZh,
    input.companyNameEn,
    input.shortName,
    input.name,
    input.ownerCompanyId,
    input.ownerCompanyName,
    input.businessCompanyId,
    input.businessCompanyName,
  ]);
}

function companyOwnerEntriesFromMapping(value: unknown): Array<{ companyKeys: string[]; ownerIds: string[] }> {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => companyOwnerEntriesFromMapping(item));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([companyKey, ownerConfig]) => {
    const ownerIds = configuredOwnerIdsFromValue(ownerConfig);
    const extraCompanyKeys = isRecord(ownerConfig) ? companyKeysFromRecord(ownerConfig) : [];
    const companyKeys = uniqueCompanyKeys([companyKey, ...extraCompanyKeys]);
    return ownerIds.length && companyKeys.length ? [{ companyKeys, ownerIds }] : [];
  });
}

function taxRefundArchiveCompanyOwnerEntriesFromSetting(value: unknown): Array<{ companyKeys: string[]; ownerIds: string[] }> {
  if (!isRecord(value)) return [];
  const directCompanyKeys = companyKeysFromRecord(value);
  const directOwnerIds = configuredOwnerIdsFromValue(value);
  const entries: Array<{ companyKeys: string[]; ownerIds: string[] }> = [];
  if (directCompanyKeys.length && directOwnerIds.length) {
    entries.push({ companyKeys: directCompanyKeys, ownerIds: directOwnerIds });
  }
  const companyMappings = [
    value.byCompany,
    value.companies,
    value.companyOwners,
    value.companyFinanceOwners,
    value.defaultFinanceByCompany,
    value.defaultFinanceOwnersByCompany,
    value.taxRefundArchiveFinanceOwnersByCompany,
  ];
  for (const mapping of companyMappings) {
    entries.push(...companyOwnerEntriesFromMapping(mapping));
  }
  return entries;
}

function systemCompanyKeysFromProfile(value: unknown) {
  const profile = isRecord(value) ? value : {};
  return uniqueCompanyKeys([
    profile.companyId,
    profile.companyCode,
    profile.companyKey,
    profile.companyName,
    profile.companyNameZh || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh,
    profile.companyNameEn || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameEn,
    profile.shortName || DEFAULT_COMPANY_PROFILE_SETTINGS.shortName,
    profile.brandName || DEFAULT_COMPANY_PROFILE_SETTINGS.brandName,
  ]);
}

function taxRefundArchiveOwnerUsersFromIds(users: TodoUser[], ownerIds: string[]) {
  const result: TodoUser[] = [];
  for (const ownerId of uniqueIds(ownerIds)) {
    const user = users.find((item) => item.id === ownerId && canWrite(item, "taxRefund"));
    if (user && !result.some((item) => item.id === user.id)) result.push(user);
  }
  return result;
}

async function createWorkbenchTodoContext(actor: ActorLike): Promise<WorkbenchTodoContext> {
  const [users, taxRefundFinanceOwnerSettings] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        approvalStatus: "APPROVED",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        supplierId: true,
        customPermissions: true,
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.systemSetting.findMany({
      where: { key: { in: [...WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS, COMPANY_PROFILE_SETTING_KEY] } },
      select: { key: true, value: true },
    }).catch(() => []),
  ]);
  const usersBySupplierId = new Map<string, TodoUser[]>();
  for (const user of users) {
    const supplierId = nonEmpty(user.supplierId);
    if (!supplierId) continue;
    const rows = usersBySupplierId.get(supplierId) || [];
    rows.push(user);
    usersBySupplierId.set(supplierId, rows);
  }
  const taxRefundArchiveFinanceUsers = users.filter((user) => user.role === "财务" && canWrite(user, "taxRefund"));
  const taxRefundOwnerSettings = taxRefundFinanceOwnerSettings
    .filter((setting) => setting.key !== COMPANY_PROFILE_SETTING_KEY);
  const companyProfileSetting = taxRefundFinanceOwnerSettings
    .find((setting) => setting.key === COMPANY_PROFILE_SETTING_KEY);
  const configuredTaxRefundFinanceOwnerIds = taxRefundOwnerSettings
    .flatMap((setting) => taxRefundArchiveOwnerIdsFromSetting(setting.value));
  const taxRefundArchiveConfiguredOwnerUsers = taxRefundArchiveOwnerUsersFromIds(users, configuredTaxRefundFinanceOwnerIds);
  const taxRefundArchiveCompanyOwnerUsersByKey = new Map<string, TodoUser[]>();
  for (const entry of taxRefundOwnerSettings.flatMap((setting) => taxRefundArchiveCompanyOwnerEntriesFromSetting(setting.value))) {
    const ownerUsers = taxRefundArchiveOwnerUsersFromIds(users, entry.ownerIds);
    if (!ownerUsers.length) continue;
    for (const companyKey of entry.companyKeys) {
      const existing = taxRefundArchiveCompanyOwnerUsersByKey.get(companyKey) || [];
      for (const user of ownerUsers) {
        if (!existing.some((item) => item.id === user.id)) existing.push(user);
      }
      taxRefundArchiveCompanyOwnerUsersByKey.set(companyKey, existing);
    }
  }
  const systemCompanyKeys = systemCompanyKeysFromProfile(companyProfileSetting?.value);
  return {
    actor,
    actorUserId: actorId(actor),
    users,
    adminUserIds: users.filter((user) => user.role === "管理员").map((user) => user.id),
    financeUsers: users.filter((user) => user.role === "财务"),
    taxRefundArchiveFinanceUsers,
    taxRefundArchiveConfiguredOwnerUsers,
    taxRefundArchiveCompanyOwnerUsersByKey,
    systemCompanyKeys,
    purchaseUsers: users.filter((user) => user.role === "采购"),
    usersBySupplierId,
  };
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

function uniqueIds(values: Array<string | null | undefined>) {
  return values.map((value) => nonEmpty(value)).filter((value, index, arr) => value && arr.indexOf(value) === index);
}

function userOwner(user: TodoUser | null | undefined, fallbackName: string, ownerRole: WorkbenchTodoOwnerRole): TodoOwner {
  return {
    ownerUserId: nonEmpty(user?.id) || null,
    ownerName: nonEmpty(user?.name) || fallbackName,
    ownerRole,
    ownerUserIds: uniqueIds([user?.id]),
  };
}

function roleOwner(context: WorkbenchTodoContext, role: WorkbenchTodoOwnerRole): TodoOwner {
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

function ownerFromUsers(ownerUsers: TodoUser[], fallbackName: string, ownerRole: WorkbenchTodoOwnerRole): TodoOwner {
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

function taxRefundArchiveCompanyKeysForOrder(context: WorkbenchTodoContext, order: TodoOrder) {
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

function taxRefundArchiveOwner(context: WorkbenchTodoContext, order?: TodoOrder): TodoOwner {
  const companyKeys = order ? taxRefundArchiveCompanyKeysForOrder(context, order) : context.systemCompanyKeys;
  for (const companyKey of companyKeys) {
    const companyOwnerUsers = context.taxRefundArchiveCompanyOwnerUsersByKey.get(companyKey) || [];
    if (companyOwnerUsers.length) return ownerFromUsers(companyOwnerUsers, "财务", "FINANCE");
  }
  const configuredUsers = context.taxRefundArchiveConfiguredOwnerUsers;
  const ownerUsers = configuredUsers.length ? configuredUsers : context.taxRefundArchiveFinanceUsers;
  return ownerFromUsers(ownerUsers, "财务", "FINANCE");
}

function salespersonOwner(order: TodoOrder): TodoOwner {
  const ownerUserId = nonEmpty(order.salesperson?.id) || nonEmpty(order.salespersonUserId) || nonEmpty(order.customer?.salespersonUserId) || null;
  return {
    ownerUserId,
    ownerName: orderOwnerName(order),
    ownerRole: "SALESPERSON",
    ownerUserIds: uniqueIds([ownerUserId]),
  };
}

function supplierOwner(context: WorkbenchTodoContext, supplier: TodoSupplier | null | undefined, ownerRole: "LOGISTICS_SUPPLIER" | "PRODUCT_SUPPLIER", fallbackName: string): TodoOwner {
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

function logisticsOwnerForOrder(context: WorkbenchTodoContext, order: TodoOrder) {
  const assigned = (order.logisticsSuppliers || []).find((row) => row?.supplier?.id || row?.supplierId);
  if (assigned?.supplier) {
    return supplierOwner(context, assigned.supplier, "LOGISTICS_SUPPLIER", "物流供应商");
  }
  return salespersonOwner(order);
}

function visibleUserIds(context: WorkbenchTodoContext, order: TodoOrder, owner?: TodoOwner | null) {
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
  return {
    id: input.id || `${input.type.toLowerCase()}-${input.order.id}`,
    type: input.type,
    title: input.title,
    module: input.module,
    orderId: input.order.id,
    orderNo: input.order.orderNo,
    customerShortName: orderCustomerShortName(input.order),
    priority: todoPriorityFromDueAt(dueAt),
    status: input.status || "pending",
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

function todoForPayment(input: {
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

function todoForLogisticsBill(input: {
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

async function listOrderTodos(context: WorkbenchTodoContext) {
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

async function listDomesticLogisticsTodos(context: WorkbenchTodoContext) {
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

async function listLogisticsFeeTodos(context: WorkbenchTodoContext) {
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

async function listSupplierDocumentTodos(context: WorkbenchTodoContext) {
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

async function listCustomerPaymentTodos(context: WorkbenchTodoContext) {
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

async function listFactoryPaymentTodos(context: WorkbenchTodoContext) {
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
    dueAt: cost.paidAt || cost.paymentDate || cost.updatedAt,
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

async function listTaxRefundTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "taxRefund") || !(isAdmin(actor) || isSalesperson(actor) || isFinance(actor))) return [];
  const rows = await prisma.receivableOrder.findMany({
    where: {
      deletedAt: null,
      taxArchived: false,
      taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES },
      AND: [orderAccessWhere(actor)],
    },
    include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } },
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
  const owner = roleOwner(context, "FINANCE");
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

async function listProfitTodos(context: WorkbenchTodoContext) {
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

async function listOceanTrackingTodos(context: WorkbenchTodoContext) {
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

async function completedTodayTodos(context: WorkbenchTodoContext, now = new Date()) {
  const actor = context.actor;
  const today = startOfChinaDay(now);
  const tomorrow = addDays(today, 1);
  const batches: Promise<WorkbenchTodo[]>[] = [];
  const productCostWhere = productSupplierPaymentCostWhere();
  if (canRead(actor, "payments") && isFinanceOperator(actor)) {
    batches.push(prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: "已到账",
        updatedAt: { gte: today, lt: tomorrow },
        order: { is: orderAccessWhere(actor) },
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((payment) => todoForPayment({
      type: "CUSTOMER_PAYMENT_CONFIRMED",
      title: "客户回款已确认",
      payment,
      context,
      owner: roleOwner(context, "FINANCE"),
      status: "completed",
    }))));
  }
  if (canRead(actor, "costs") && isFinanceOperator(actor)) {
    batches.push(prisma.orderCost.findMany({
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
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
        supplier: { select: { id: true, supplierName: true, supplierType: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((cost) => todoForCost({
      type: "FACTORY_PAYMENT_COMPLETED",
      title: "工厂付款已登记",
      module: "成本管理",
      cost,
      context,
      dueAt: cost.paidAt || cost.paymentDate || cost.updatedAt,
      owner: roleOwner(context, "FINANCE"),
      status: "completed",
    }))));
  }
  if (canRead(actor, "supplierDocuments") && (isAdmin(actor) || isProductSupplierOperatorRole(actorRole(actor)))) {
    batches.push(prisma.supplierDocumentRequest.findMany({
      where: {
        deletedAt: null,
        status: "已完成",
        updatedAt: { gte: today, lt: tomorrow },
        ...(isProductSupplierOperatorRole(actorRole(actor))
          ? { supplierId: actorSupplierId(actor) || "__no_supplier_bound__" }
          : {}),
      },
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
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((row) => todoForOrder({
      id: `supplier-document-return-completed-${row.id}`,
      type: "SUPPLIER_DOCUMENT_RETURN_COMPLETED",
      title: "供应商资料已回传",
      module: "资料回传",
      order: row.order,
      context,
      dueAt: row.dueDate || row.updatedAt,
      href: orderHref("/supplier-documents", row.order, {
        requestId: row.id,
        keyword: row.order.orderNo,
      }),
      owner: supplierOwner(context, row.supplier, "PRODUCT_SUPPLIER", "产品供应商"),
      status: "completed",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))));
  }
  if ((canRead(actor, "domesticLogistics") || canRead(actor, "costs")) && (isAdmin(actor) || isSalesperson(actor) || isFinance(actor) || isLogisticsOperator(actor))) {
    const accessWhere = logisticsBillAccessWhere(actor);
    batches.push(prisma.logisticsBill.findMany({
      where: {
        deletedAt: null,
        AND: [
          accessWhere,
          {
            OR: [
              { auditStatus: "审核通过", reviewedAt: { gte: today, lt: tomorrow } },
              { invoiceStatus: { in: LOGISTICS_INVOICE_DONE_STATUSES }, updatedAt: { gte: today, lt: tomorrow } },
            ],
          },
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
        supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((bill) => {
      const invoiceDone = LOGISTICS_INVOICE_DONE_STATUSES.includes(bill.invoiceStatus || "");
      const owner = invoiceDone
        ? (bill.supplier ? supplierOwner(context, bill.supplier, "LOGISTICS_SUPPLIER", "物流供应商") : logisticsOwnerForOrder(context, bill.order))
        : roleOwner(context, "FINANCE");
      return todoForLogisticsBill({
        type: invoiceDone ? "LOGISTICS_INVOICE_UPLOAD_COMPLETED" : "LOGISTICS_FEE_REVIEW_COMPLETED",
        title: invoiceDone ? "物流发票已上传" : "物流费用已审核",
        bill,
        context,
        dueAt: invoiceDone ? bill.updatedAt : (bill.reviewedAt || bill.updatedAt),
        owner,
        ownerName: owner.ownerName || (invoiceDone ? "物流供应商" : "财务/管理员"),
        status: "completed",
      });
    })));
  }
  if (canRead(actor, "domesticLogistics") && isFinanceOperator(actor)) {
    batches.push(prisma.logisticsBill.findMany({
      where: {
        deletedAt: null,
        AND: [
          logisticsBillAccessWhere(actor),
          { auditStatus: "审核通过" },
          { paymentStatus: "已付款" },
          { updatedAt: { gte: today, lt: tomorrow } },
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
        supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_PAYMENT_REGISTER_COMPLETED",
      title: "物流付款已登记",
      bill,
      context,
      dueAt: bill.paymentDate || bill.updatedAt,
      owner: roleOwner(context, "FINANCE"),
      ownerName: "财务/管理员",
      status: "completed",
    }))));
  }
  if (canRead(actor, "taxRefund") && (isAdmin(actor) || isSalesperson(actor) || isFinance(actor))) {
    batches.push(prisma.receivableOrder.findMany({
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
      status: "completed",
      updatedAt: order.updatedAt,
    }))));
  }
  if (canRead(actor, "commissions") && isFinanceOperator(actor)) {
    batches.push(prisma.receivableOrder.findMany({
      where: {
        deletedAt: null,
        commissionStatus: { in: ["已结算", "SETTLED"] },
        commissionSettledAt: { gte: today, lt: tomorrow },
        AND: [orderAccessWhere(actor)],
      },
      include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ commissionSettledAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((order) => todoForOrder({
      type: "COMMISSION_SETTLED",
      title: "提成已结算",
      module: "利润分析",
      order,
      context,
      dueAt: order.commissionSettledAt || order.updatedAt,
      href: orderHref("/profit", order),
      owner: roleOwner(context, "FINANCE"),
      status: "completed",
      updatedAt: order.updatedAt,
    }))));
  }
  if (canRead(actor, "domesticLogistics") && (isAdmin(actor) || isSalesperson(actor) || isLogisticsOperator(actor))) {
    batches.push(prisma.shipsgoTracking.findMany({
      where: {
        AND: [
          shipsgoTrackingAccessWhere(actor),
          {
            deletedAt: null,
            provider: "SHIPSGO",
            mode: "OCEAN",
            lastSyncTime: { gte: today, lt: tomorrow },
          },
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
      },
      orderBy: [{ lastSyncTime: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((row) => todoForOrder({
      id: `container-tracking-synced-${row.id}`,
      type: "CONTAINER_TRACKING_SYNCED",
      title: "集装箱跟踪已同步",
      module: "运输监控",
      order: row.order,
      context,
      dueAt: row.lastSyncTime || row.lastSyncedAt || row.updatedAt,
      href: orderHref("/ocean-control-tower", row.order, {
        trackingId: row.id,
        keyword: row.order.orderNo,
      }),
      owner: salespersonOwner(row.order),
      status: "completed",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))));
  }
  const values = await Promise.all(batches);
  return uniqueTodos(values.flat()).sort(sortWorkbenchTodos);
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
  const context = await createWorkbenchTodoContext(actor);
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
    completedTodos,
  ] = await Promise.all([
    listOrderTodos(context),
    listDomesticLogisticsTodos(context),
    listLogisticsFeeTodos(context),
    listSupplierDocumentTodos(context),
    listCustomerPaymentTodos(context),
    listFactoryPaymentTodos(context),
    listTaxRefundTodos(context),
    listProfitTodos(context),
    listOceanTrackingTodos(context),
    completedTodayTodos(context),
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
    completedTodos,
    summary: summarizeWorkbenchTodos(todos, completedTodos.length),
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
