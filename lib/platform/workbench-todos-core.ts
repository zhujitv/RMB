import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { orderAccessWhere, orderSalespersonOwnershipWhere } from "./order-access";
import { canRead, canWrite } from "./shared-access";
import {
  addDays,
  startOfChinaDay,
  summarizeWorkbenchTodos,
  todoActivationRuleForType,
  todoPriorityFromDueAt,
} from "./workbench-todo-rules";
import type { WorkbenchFlowStage, WorkbenchTodoPriority, WorkbenchTodoStatus, WorkbenchTodoSummary } from "./workbench-todo-rules";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  COMPANY_PROFILE_SETTING_KEY,
  DEFAULT_COMPANY_PROFILE_SETTINGS,
  FACTORY_SUPPLIER_COST_TYPES,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE,
  PRODUCT_SUPPLIER_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  cachedTaxRefundCompleteness,
  customerShortName,
  getCommissionFormulaSettings,
  getExchangeRateSettings,
  includeOrderRelations,
  isLogisticsCostType,
  isProductSupplierOperatorRole,
  isProductSupplierType,
  listShipsgoControlTowerTrackings,
  needsTaxRefundCompletenessRefresh,
  nonEmpty,
  normalizeDateText,
  summarizeOrder,
  taxRefundStatusFromCompleteness,
  validCost,
} from "./shared";

export type { WorkbenchFlowStage, WorkbenchTodoPriority, WorkbenchTodoStatus, WorkbenchTodoSummary } from "./workbench-todo-rules";
export type WorkbenchTodoOwnerRole = "LOGISTICS_SUPPLIER" | "SALESPERSON" | "ADMIN" | "FINANCE" | "PURCHASE" | "PRODUCT_SUPPLIER";
export type WorkbenchTodo = {
  id: string;
  type: string;
  title: string;
  module: string;
  flowStage: WorkbenchFlowStage;
  prerequisiteStage?: WorkbenchFlowStage | null;
  activationCondition: string;
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
export type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

export type TodoOrder = {
  id: string;
  orderNo: string;
  blNo?: string | null;
  status?: string | null;
  customerNameSnapshot?: string | null;
  dueDate?: Date | string | null;
  expectedShipmentDate?: Date | string | null;
  expectedArrivalDate?: Date | string | null;
  actualShipmentDate?: Date | string | null;
  blDate?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  taxRefundCompletenessUpdatedAt?: Date | string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxSubmittedAt?: Date | string | null;
  taxArchived?: boolean | null;
  taxRefundStatus?: string | null;
  salespersonUserId?: string | null;
  customer?: { shortName?: string | null; salespersonUserId?: string | null } | null;
  salesperson?: { id?: string | null; name?: string | null; email?: string | null; role?: string | null } | null;
  logisticsSuppliers?: TodoLogisticsSupplierAssignment[] | null;
  supplierDocumentRequests?: Array<{ status?: string | null; supplierId?: string | null; costId?: string | null; completedAt?: Date | string | null; deletedAt?: Date | string | null }> | null;
  documents?: Array<{ documentType?: string | null; uploadStatus?: string | null; relatedModule?: string | null; deletedAt?: Date | string | null }> | null;
};

export type TodoUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
};

export type TodoSupplier = {
  id?: string | null;
  supplierName?: string | null;
  supplierType?: string | null;
  email?: string | null;
  operatorUsers?: TodoUser[] | null;
};

export type TodoLogisticsSupplierAssignment = {
  supplierId?: string | null;
  supplier?: TodoSupplier | null;
};

export type TodoOwner = {
  ownerUserId?: string | null;
  ownerName?: string | null;
  ownerRole: WorkbenchTodoOwnerRole;
  ownerUserIds?: string[];
  visibleToUserIds?: string[];
};

export type WorkbenchTodoContext = {
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
  paymentVoucherReminderStartDate: Date;
};

export const TODO_LIMIT_PER_SOURCE = 80;
export const WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS = [
  "workbench_tax_refund_archive_finance_owner",
  "tax_refund_archive_finance_owner",
  "workbench_default_finance_owner",
];
export const PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE = ["已完成", "已关闭"];
export const LOGISTICS_INVOICE_DONE_STATUSES = ["已上传发票", "已确认", "已确认发票"];
export const LOGISTICS_INVOICE_REVIEW_STATUSES = ["已上传发票", "部分上传发票", "部分已确认"];
export const LOGISTICS_PAYMENT_READY_INVOICE_STATUSES = ["已确认", "已确认发票"];
export const LOGISTICS_PAYMENT_DONE_STATUSES = ["已付款"];
export const NEGATIVE_PROFIT_THRESHOLD = 0;
export const PROFIT_COST_REVIEW_STATUSES = ["生产中", "已发货", "部分收款", "已收齐", "多收款"];
export const PROFIT_COST_REQUIRED_STATUSES = ["已发货", "部分收款", "已收齐", "多收款"];

export function paymentVoucherReminderStartDateFromSettings(settings: unknown) {
  const input = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const text = normalizeDateText(input.paymentVoucherReminderStartDate, PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE);
  const dateText = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE;
  const date = new Date(`${dateText}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? new Date(`${PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE}T00:00:00.000Z`)
    : date;
}

export type TodoCost = {
  id: string;
  order: TodoOrder;
  supplierId?: string | null;
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
  documents?: Array<{ documentType?: string | null; uploadStatus?: string | null; relatedModule?: string | null; costId?: string | null; supplierId?: string | null; deletedAt?: Date | string | null }> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type TodoPayment = {
  id: string;
  order: TodoOrder;
  paymentDate?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type TodoLogisticsBill = {
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

export type ProfitOrder = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;

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

export function configuredOwnerIdsFromValue(value: unknown): string[] {
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

export function taxRefundArchiveOwnerIdsFromSetting(value: unknown) {
  return configuredOwnerIdsFromValue(value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function ownerCompanyKey(value: unknown) {
  return nonEmpty(value).toLowerCase();
}

export function uniqueCompanyKeys(values: unknown[]) {
  return values.map(ownerCompanyKey).filter((value, index, arr) => value && arr.indexOf(value) === index);
}

export function companyKeysFromRecord(input: Record<string, unknown>) {
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

export function companyOwnerEntriesFromMapping(value: unknown): Array<{ companyKeys: string[]; ownerIds: string[] }> {
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

export function taxRefundArchiveCompanyOwnerEntriesFromSetting(value: unknown): Array<{ companyKeys: string[]; ownerIds: string[] }> {
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

export function systemCompanyKeysFromProfile(value: unknown) {
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

export function taxRefundArchiveOwnerUsersFromIds(users: TodoUser[], ownerIds: string[]) {
  const result: TodoUser[] = [];
  for (const ownerId of uniqueIds(ownerIds)) {
    const user = users.find((item) => item.id === ownerId && canWrite(item, "taxRefund"));
    if (user && !result.some((item) => item.id === user.id)) result.push(user);
  }
  return result;
}

export async function createWorkbenchTodoContext(actor: ActorLike): Promise<WorkbenchTodoContext> {
  const [users, taxRefundFinanceOwnerSettings, exchangeRateSettings] = await Promise.all([
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
      take: 500,
    }),
    prisma.systemSetting.findMany({
      where: { key: { in: [...WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS, COMPANY_PROFILE_SETTING_KEY] } },
      select: { key: true, value: true },
      take: WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS.length + 1,
    }).catch(() => []),
    getExchangeRateSettings(),
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
    paymentVoucherReminderStartDate: paymentVoucherReminderStartDateFromSettings(exchangeRateSettings),
  };
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

export function uniqueIds(values: Array<string | null | undefined>) {
  return values.map((value) => nonEmpty(value)).filter((value, index, arr) => value && arr.indexOf(value) === index);
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
    sourceType: { not: "LOGISTICS_EXPENSE" },
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
  if (cost.sourceType === "LOGISTICS_EXPENSE" || isLogisticsCostType(cost.costType || "")) return false;
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
