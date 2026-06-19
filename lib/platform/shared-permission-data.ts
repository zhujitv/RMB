// @ts-nocheck
export const WRITE_PERMISSIONS = {
  users: ["管理员"],
  customers: ["管理员"],
  orders: ["管理员", "业务员"],
  payments: ["管理员", "财务"],
  costs: ["管理员", "业务员"],
  logistics: ["管理员", "物流供应商"],
  domesticLogistics: ["管理员", "业务员", "物流供应商", "物流资料录入员"],
  documents: ["管理员", "业务员", "财务", "物流供应商", "物流资料录入员"],
  taxRefund: ["管理员", "财务"],
  commissions: ["管理员", "财务"],
  suppliers: ["管理员"],
  settings: ["管理员"],
  exchangeRates: ["管理员", "财务"],
};

export const ROLE_MENUS = {
  管理员: ["dashboard", "orders", "payments", "costs", "profit", "domesticLogistics", "taxRefund", "reports", "manual", "settings"],
  业务员: ["orders", "payments", "costs", "profit", "domesticLogistics", "taxRefund", "reports", "manual"],
  财务: ["payments", "costs", "profit", "domesticLogistics", "taxRefund", "reports", "manual"],
  物流供应商: ["domesticLogistics", "manual"],
  物流资料录入员: ["domesticLogistics", "manual"],
};

export const ROLE_SCOPE_TEXT = {
  管理员: "可查看和管理全部数据",
  业务员: "仅可查看本人客户和订单",
  财务: "可查看全部应收和收款数据",
  物流供应商: "仅可查看分配订单、提交物流费用并上传发票",
  物流资料录入员: "可录入物流信息和报关资料",
};

export const READ_PERMISSIONS = {
  users: ["管理员"],
  customers: ["管理员", "业务员"],
  suppliers: ["管理员"],
  orders: ["管理员", "业务员", "财务"],
  payments: ["管理员", "业务员", "财务"],
  costs: ["管理员", "业务员", "财务"],
  domesticLogistics: ["管理员", "业务员", "物流供应商", "物流资料录入员"],
  documents: ["管理员", "业务员", "财务", "物流供应商", "物流资料录入员"],
  taxRefund: ["管理员", "业务员", "财务"],
  commissions: ["管理员", "业务员", "财务"],
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
    taxRefund: "退税资料",
    reports: "报表中心",
    manual: "操作说明书",
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
    taxRefund: "退税状态",
    commissions: "提成结算",
    suppliers: "供应商维护",
    settings: "系统设置",
    exchangeRates: "汇率刷新",
  },
};

export function permissionMode(value) {
  return PERMISSION_MODES.includes(value) ? value : "ROLE";
}

export function checkedPermissionList(values, allowed) {
  const rows = Array.isArray(values) ? values : [];
  return rows
    .map((item) => String(item || "").trim())
    .filter((item, index, arr) => allowed.includes(item) && arr.indexOf(item) === index);
}

export function permissionObject(keys, enabledKeys = []) {
  return Object.fromEntries(keys.map((key) => [key, enabledKeys.includes(key)]));
}

export function roleReadKeys(role) {
  return READ_PERMISSION_KEYS.filter((area) => READ_PERMISSIONS[area]?.includes(role));
}

export function roleWriteKeys(role) {
  return WRITE_PERMISSION_KEYS.filter((area) => WRITE_PERMISSIONS[area]?.includes(role));
}

export function roleDataScope(role) {
  if (role === "管理员" || role === "财务") return "ALL";
  if (role === "业务员") return "OWN";
  if (role === "物流供应商") return "OWN";
  if (role === "物流资料录入员") return "OWN";
  return "NONE";
}

export function customDataScopeFallback(role, writeKeys = []) {
  if (role === "管理员" || role === "财务") return "ALL";
  if (role === "业务员") return "OWN";
  if (role === "物流供应商") return "OWN";
  if (role === "物流资料录入员") return "OWN";
  return writeKeys.length ? "OWN" : roleDataScope(role);
}

export function pageParams(query, defaultPageSize = 20, maxPageSize = 100) {
  const page = Math.max(1, Number.parseInt(query?.get("page") || "1", 10) || 1);
  const rawPageSize = Number.parseInt(query?.get("pageSize") || String(defaultPageSize), 10) || defaultPageSize;
  const pageSize = Math.min(maxPageSize, Math.max(1, rawPageSize));
  return { page, pageSize };
}

export function pageResult(rows, total, page, pageSize) {
  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / Math.max(pageSize, 1))),
  };
}

export function optionList(keys, labels) {
  return keys.map((value) => ({ value, label: labels[value] || value }));
}

export function roleMenus(role) {
  return ROLE_MENUS[role] || [];
}

export function roleScopeText(role) {
  return ROLE_SCOPE_TEXT[role] || "未配置权限";
}

export function rolePermissionSnapshot(role) {
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

export function normalizedCustomPermissionInput(value, role) {
  const input = value && typeof value === "object" ? value : {};
  const mode = permissionMode(input.mode || input.permissionMode);
  if (mode !== "CUSTOM") return null;
  const fallback = rolePermissionSnapshot(role);
  const menus = checkedPermissionList(input.menus ?? fallback.menus, MENU_KEYS);
  const readKeys = checkedPermissionList(input.reads ?? input.readKeys ?? fallback.readKeys, READ_PERMISSION_KEYS);
  const writeKeys = checkedPermissionList(input.writes ?? input.writeKeys ?? fallback.writeKeys, WRITE_PERMISSION_KEYS);
  const dataScope = DATA_SCOPES.includes(input.dataScope)
    ? input.dataScope
    : customDataScopeFallback(role, writeKeys);
  return {
    mode: "CUSTOM",
    menus,
    reads: readKeys,
    writes: writeKeys,
    dataScope,
  };
}

export function effectivePermissions(user) {
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
