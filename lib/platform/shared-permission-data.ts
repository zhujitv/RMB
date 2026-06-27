type PermissionInput = Record<string, unknown>;
type QueryLike = {
  get: (key: string) => string | null;
};

const PRODUCT_SUPPLIER_ACCOUNT_ROLE = "产品供应商账号";
const LEGACY_FACTORY_SUPPLIER_ACCOUNT_ROLE = "工厂供应商账号";
const SUPPLIER_DOCUMENT_ROLES = [PRODUCT_SUPPLIER_ACCOUNT_ROLE, LEGACY_FACTORY_SUPPLIER_ACCOUNT_ROLE];

export const WRITE_PERMISSIONS: Record<string, string[]> = {
  users: ["管理员"],
  customers: ["管理员"],
  orders: ["管理员", "业务员"],
  payments: ["管理员", "财务"],
  costs: ["管理员", "业务员"],
  logistics: ["管理员", "物流供应商"],
  domesticLogistics: ["管理员", "业务员", "物流供应商", "物流资料录入员"],
  documents: ["管理员", "业务员", "财务", "物流供应商", "物流资料录入员"],
  supplierDocuments: ["管理员", ...SUPPLIER_DOCUMENT_ROLES],
  taxRefund: ["管理员", "财务"],
  commissions: ["管理员", "财务"],
  suppliers: ["管理员"],
  settings: ["管理员"],
  exchangeRates: ["管理员", "财务"],
};

export const ROLE_MENUS: Record<string, string[]> = {
  管理员: ["dashboard", "orders", "payments", "costs", "profit", "domesticLogistics", "oceanControlTower", "supplierDocuments", "taxRefund", "reports", "manual", "settings"],
  业务员: ["orders", "payments", "costs", "domesticLogistics", "oceanControlTower", "taxRefund", "reports", "manual"],
  财务: ["payments", "costs", "profit", "domesticLogistics", "taxRefund", "reports", "manual"],
  物流供应商: ["domesticLogistics", "manual"],
  产品供应商账号: ["supplierDocuments", "manual"],
  工厂供应商账号: ["supplierDocuments", "manual"],
  物流资料录入员: ["domesticLogistics", "oceanControlTower", "manual"],
};

const OCEAN_CONTROL_TOWER_ROLES = ["管理员", "业务员", "物流资料录入员"];

export function menusWithDerivedAccess(role: string, menus: string[]) {
  if (!OCEAN_CONTROL_TOWER_ROLES.includes(role) || !menus.includes("domesticLogistics") || menus.includes("oceanControlTower")) {
    return menus;
  }
  const nextMenus = [...menus];
  nextMenus.splice(nextMenus.indexOf("domesticLogistics") + 1, 0, "oceanControlTower");
  return nextMenus;
}

export const ROLE_SCOPE_TEXT: Record<string, string> = {
  管理员: "可查看和管理全部数据",
  业务员: "仅可查看本人客户和订单",
  财务: "可查看全部应收和收款数据",
  物流供应商: "仅可查看分配订单、提交物流费用并上传发票",
  产品供应商账号: "仅可查看资料回传任务并上传工厂合同、增值税发票",
  工厂供应商账号: "仅可查看资料回传任务并上传工厂合同、增值税发票",
  物流资料录入员: "可录入物流信息和报关资料",
};

export const READ_PERMISSIONS: Record<string, string[]> = {
  users: ["管理员"],
  customers: ["管理员", "业务员"],
  suppliers: ["管理员"],
  orders: ["管理员", "业务员", "财务"],
  payments: ["管理员", "业务员", "财务"],
  costs: ["管理员", "业务员", "财务"],
  domesticLogistics: ["管理员", "业务员", "物流供应商", "物流资料录入员"],
  documents: ["管理员", "业务员", "财务", "物流供应商", "物流资料录入员"],
  supplierDocuments: ["管理员", ...SUPPLIER_DOCUMENT_ROLES],
  taxRefund: ["管理员", "业务员", "财务"],
  commissions: ["管理员", "财务"],
  reports: ["管理员", "业务员", "财务"],
  settings: ["管理员"],
  auditLogs: ["管理员"],
};

export const CUSTOMER_VIEW_ALL_ROLES = ["管理员"];
export const PERMISSION_MODES = ["ROLE", "CUSTOM"];
export const DATA_SCOPES = ["ALL", "OWN", "OWN_COST", "NONE"];
export const MENU_KEYS = Object.values(ROLE_MENUS).flat()
  .filter((item, index, arr) => arr.indexOf(item) === index);
export const READ_PERMISSION_KEYS = Object.keys(READ_PERMISSIONS);
export const WRITE_PERMISSION_KEYS = Object.keys(WRITE_PERMISSIONS);
export const UNSAFE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
export const SETTINGS_PERMISSION_LABELS = {
  menu: {
    dashboard: "经营总览",
    orders: "应收订单",
    payments: "收款管理",
    costs: "成本管理",
    profit: "利润分析",
    domesticLogistics: "物流信息",
    oceanControlTower: "运输监控",
    supplierDocuments: "资料回传",
    taxRefund: "退税资料",
    reports: "报表中心",
    manual: "操作手册",
    settings: "系统设置",
  },
  read: {
    users: "用户查看",
    customers: "客户查看",
    suppliers: "供应商查看",
    orders: "应收订单查看",
    payments: "收款查看",
    costs: "成本查看",
    domesticLogistics: "物流信息查看",
    documents: "单证查看",
    supplierDocuments: "供应商资料回传查看",
    taxRefund: "退税查看",
    commissions: "提成查看",
    reports: "报表查看",
    settings: "系统设置查看",
    auditLogs: "操作日志查看",
  },
  write: {
    users: "用户管理",
    customers: "客户维护",
    orders: "应收订单保存",
    payments: "收款登记",
    costs: "成本录入",
    logistics: "物流费用",
    domesticLogistics: "物流信息录入",
    documents: "单证上传/删除",
    supplierDocuments: "供应商资料回传",
    taxRefund: "退税状态",
    commissions: "提成结算",
    suppliers: "供应商维护",
    settings: "系统设置",
    exchangeRates: "汇率刷新",
  },
};

export function permissionMode(value: unknown) {
  const mode = String(value || "");
  return PERMISSION_MODES.includes(mode) ? mode : "ROLE";
}

export function checkedPermissionList(values: unknown, allowed: string[]) {
  const rows = Array.isArray(values) ? values : [];
  return rows
    .map((item) => String(item || "").trim())
    .filter((item, index, arr) => allowed.includes(item) && arr.indexOf(item) === index);
}

export function permissionObject(keys: string[], enabledKeys: string[] = []) {
  return Object.fromEntries(keys.map((key) => [key, enabledKeys.includes(key)]));
}

export function roleReadKeys(role: string) {
  return READ_PERMISSION_KEYS.filter((area) => READ_PERMISSIONS[area]?.includes(role));
}

export function roleWriteKeys(role: string) {
  return WRITE_PERMISSION_KEYS.filter((area) => WRITE_PERMISSIONS[area]?.includes(role));
}

export function roleDataScope(role: string) {
  if (role === "管理员" || role === "财务") return "ALL";
  if (role === "业务员") return "OWN";
  if (role === "物流供应商") return "OWN";
  if (SUPPLIER_DOCUMENT_ROLES.includes(role)) return "OWN";
  if (role === "物流资料录入员") return "OWN";
  return "NONE";
}

export function customDataScopeFallback(role: string, writeKeys: string[] = []) {
  if (role === "管理员" || role === "财务") return "ALL";
  if (role === "业务员") return "OWN";
  if (role === "物流供应商") return "OWN";
  if (SUPPLIER_DOCUMENT_ROLES.includes(role)) return "OWN";
  if (role === "物流资料录入员") return "OWN";
  return writeKeys.length ? "OWN" : roleDataScope(role);
}

export function pageParams(query: QueryLike | null | undefined, defaultPageSize = 20, maxPageSize = 100) {
  const page = Math.max(1, Number.parseInt(query?.get("page") || "1", 10) || 1);
  const rawPageSize = Number.parseInt(query?.get("pageSize") || String(defaultPageSize), 10) || defaultPageSize;
  const pageSize = Math.min(maxPageSize, Math.max(1, rawPageSize));
  return { page, pageSize };
}

export function pageResult<T>(rows: T[], total: number, page: number, pageSize: number) {
  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
  };
}

export function optionList(keys: string[], labels: Record<string, string>) {
  return keys.map((value) => ({ value, label: labels[value] || value }));
}

export function roleMenus(role?: string | null) {
  const roleName = String(role || "");
  return menusWithDerivedAccess(roleName, ROLE_MENUS[roleName] || []);
}

export function roleScopeText(role?: string | null) {
  return ROLE_SCOPE_TEXT[String(role || "")] || "未配置权限";
}

export function rolePermissionSnapshot(role: string) {
  const menus = roleMenus(role);
  const readKeys = roleReadKeys(role);
  const writeKeys = roleWriteKeys(role);
  return {
    mode: "ROLE",
    menus,
    readKeys,
    writeKeys,
    reads: permissionObject(READ_PERMISSION_KEYS, readKeys),
    writes: permissionObject(WRITE_PERMISSION_KEYS, writeKeys),
    dataScope: roleDataScope(role),
    scopeText: roleScopeText(role),
  };
}

export function normalizedCustomPermissionInput(value: unknown, role: string) {
  const input: PermissionInput = value && typeof value === "object" ? value as PermissionInput : {};
  const mode = permissionMode(input.mode || input.permissionMode);
  if (mode !== "CUSTOM") return null;
  const fallback = rolePermissionSnapshot(role);
  const menus = menusWithDerivedAccess(role, checkedPermissionList(input.menus ?? fallback.menus, MENU_KEYS));
  const readKeys = checkedPermissionList(input.reads ?? input.readKeys ?? fallback.readKeys, READ_PERMISSION_KEYS);
  const writeKeys = checkedPermissionList(input.writes ?? input.writeKeys ?? fallback.writeKeys, WRITE_PERMISSION_KEYS);
  const requestedDataScope = String(input.dataScope || "");
  const dataScope = DATA_SCOPES.includes(requestedDataScope)
    ? requestedDataScope
    : customDataScopeFallback(role, writeKeys);
  return {
    mode: "CUSTOM",
    menus,
    reads: readKeys,
    writes: writeKeys,
    dataScope,
  };
}

export function effectivePermissions(user: { role?: string | null; customPermissions?: unknown } | null | undefined) {
  const role = user?.role || "";
  const base = rolePermissionSnapshot(role);
  if (role === "管理员") return base;
  const custom = normalizedCustomPermissionInput(user?.customPermissions, role);
  if (!custom) return base;
  return {
    mode: "CUSTOM",
    menus: custom.menus,
    readKeys: custom.reads,
    writeKeys: custom.writes,
    reads: permissionObject(READ_PERMISSION_KEYS, custom.reads),
    writes: permissionObject(WRITE_PERMISSION_KEYS, custom.writes),
    dataScope: custom.dataScope,
    scopeText: `${roleScopeText(role)}；自定义组合权限`,
  };
}
