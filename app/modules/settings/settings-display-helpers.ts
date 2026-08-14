import { formatDateTime, yesNo } from "../../formatters";
import { LOGISTICS_SUPPLIER_TYPES } from "./constants";
import type { AuditLogRow, CustomerRow, SettingsTabKey, SupplierRow, TableColumn, UserRow } from "./types";
import { approvalStatusText, emailListText, isSupplierAccountRole, shippingDocumentTypeLabels, supplierDisplayName, supplierTypeLabel, userStatus } from "./settings-label-helpers";

export const CUSTOMER_COLUMNS: TableColumn<CustomerRow>[] = [
  { key: "shortName", label: "客户简称", render: (row) => row.shortName || "-" },
  { key: "country", label: "国家" },
  { key: "defaultCurrency", label: "默认币种" },
  { key: "salespersonName", label: "负责业务员" },
  { key: "commissionStatus", label: "提成状态" },
];

export const SUPPLIER_COLUMNS: TableColumn<SupplierRow>[] = [
  { key: "supplierName", label: "供应商" },
  {
    key: "supplierType",
    label: "类型",
    render: (row) => supplierTypeLabel(row.supplierType) || "-",
  },
  { key: "status", label: "状态" },
  { key: "contactPerson", label: "联系人" },
  {
    key: "allowLogisticsInvoiceUpload",
    label: "发票上传",
    render: (row) => LOGISTICS_SUPPLIER_TYPES.includes(row.supplierType || "")
      ? (row.allowLogisticsInvoiceUpload ? "已开通" : "未开通")
      : "-",
  },
  { key: "isDefaultLogisticsSupplier", label: "默认物流", render: (row) => LOGISTICS_SUPPLIER_TYPES.includes(row.supplierType || "") ? yesNo(row.isDefaultLogisticsSupplier) : "-" },
];

export const USER_COLUMNS: TableColumn<UserRow>[] = [
  { key: "name", label: "姓名" },
  { key: "email", label: "邮箱" },
  { key: "role", label: "角色" },
  { key: "supplierName", label: "所属供应商", render: (row) => isSupplierAccountRole(row.role) ? (supplierDisplayName(row) || "-") : "-" },
  { key: "emailVerified", label: "邮箱验证", render: (row) => row.emailVerified === false ? "未验证" : "已验证" },
  { key: "createdAt", label: "注册时间", render: (row) => formatDateTime(row.createdAt) },
  { key: "approvalStatus", label: "审核状态", render: (row) => approvalStatusText(row.approvalStatus) },
  { key: "accountStatus", label: "账号状态", render: (row) => userStatus(row) },
  { key: "permissionMode", label: "权限模式", render: (row) => row.permissionMode === "CUSTOM" ? "自定义" : "角色默认" },
];

export const AUDIT_COLUMNS: TableColumn<AuditLogRow>[] = [
  { key: "createdAt", label: "时间", render: (row) => formatDateTime(row.createdAt) },
  { key: "user", label: "操作人", render: (row) => row.user?.name || "-" },
  { key: "action", label: "动作" },
  { key: "entityLabel", label: "对象" },
  { key: "ipAddress", label: "IP" },
];

export function columnsFor(tab: SettingsTabKey) {
  if (tab === "customers" || tab === "customerProducts") return CUSTOMER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  if (tab === "suppliers") return SUPPLIER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  if (tab === "users") return USER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  return AUDIT_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
}

export function rowsFor(tab: SettingsTabKey, rows: {
  customers: CustomerRow[];
  suppliers: SupplierRow[];
  users: UserRow[];
  logs: AuditLogRow[];
}) {
  if (tab === "customers" || tab === "customerProducts") return rows.customers;
  if (tab === "suppliers") return rows.suppliers;
  if (tab === "users") return rows.users;
  if (tab === "auditLogs") return rows.logs;
  return [];
}

export function detailFieldsFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return [
      { label: "客户全称", value: customer.fullName || customer.name || "-", wide: true },
      { label: "客户简称", value: customer.shortName || "-" },
      { label: "国家", value: customer.country || "-" },
      { label: "默认币种", value: customer.defaultCurrency || "-" },
      { label: "负责业务员", value: customer.salespersonName || "-" },
      { label: "提成比例", value: `${Number(customer.commissionRate || 0).toFixed(2)}%` },
      { label: "联系人", value: customer.contactPerson || "-" },
      { label: "清关资料自动通知", value: yesNo(customer.enableAutoShippingDocsNotification) },
      { label: "清关资料接收邮箱", value: emailListText(customer.shippingDocsEmails) || "默认使用客户主邮箱", wide: true },
      { label: "抄送邮箱", value: emailListText(customer.shippingDocsCcEmails), wide: true },
      { label: "清关邮件语言", value: customer.clearanceEmailLanguageLabel || (customer.clearanceEmailLanguage === "RU" ? "Русский" : "English") },
      { label: "自动发送资料", value: shippingDocumentTypeLabels(customer.autoSendDocumentTypes), wide: true },
      { label: "备注", value: customer.remark || "-", wide: true },
    ];
  }
  if (tab === "users") {
    const user = row as UserRow;
    return [
      { label: "姓名", value: user.name || "-" },
      { label: "邮箱", value: user.email || "-", wide: true },
      { label: "角色", value: user.role || "-" },
      { label: "邮箱验证", value: user.emailVerified === false ? "未验证" : "已验证" },
      { label: "注册时间", value: formatDateTime(user.createdAt) },
      { label: "审核状态", value: approvalStatusText(user.approvalStatus) },
      { label: "账号状态", value: userStatus(user) },
      { label: "权限模式", value: user.permissionMode === "CUSTOM" ? "自定义" : "角色默认" },
      { label: "数据范围", value: user.customPermissions?.dataScope || "-" },
      { label: "菜单权限", value: user.customPermissions?.menus?.length ? `${user.customPermissions.menus.length} 项自定义` : "-" },
      { label: "查看权限", value: user.customPermissions?.reads?.length ? `${user.customPermissions.reads.length} 项自定义` : "-" },
      { label: "操作权限", value: user.customPermissions?.writes?.length ? `${user.customPermissions.writes.length} 项自定义` : "-" },
      { label: "绑定供应商", value: isSupplierAccountRole(user.role) ? (supplierDisplayName(user) || "-") : "-", wide: isSupplierAccountRole(user.role) },
      { label: "首次改密", value: yesNo(user.mustChangePassword) },
    ];
  }
  const log = row as AuditLogRow;
  return [
    { label: "时间", value: formatDateTime(log.createdAt) },
    { label: "操作人", value: log.user?.name || "-" },
    { label: "动作", value: log.action || "-" },
    { label: "对象", value: log.entityLabel || "-", wide: true },
    { label: "IP", value: log.ipAddress || "-" },
  ];
}

export function drawerTitleFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return customer.shortName || customer.name || "客户详情";
  }
  if (tab === "users") {
    const user = row as UserRow;
    return user.name || user.email || "用户详情";
  }
  const log = row as AuditLogRow;
  return log.entityLabel || log.action || "操作日志";
}

export function drawerSubtitleFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return `国家：${customer.country || "-"} · 默认币种：${customer.defaultCurrency || "-"}`;
  }
  if (tab === "users") {
    const user = row as UserRow;
    return `角色：${user.role || "-"} · 状态：${userStatus(user)}`;
  }
  const log = row as AuditLogRow;
  return `时间：${formatDateTime(log.createdAt)} · 操作人：${log.user?.name || "-"}`;
}

export function valueFor(row: CustomerRow | SupplierRow | UserRow | AuditLogRow, column: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>) {
  if (column.render) return column.render(row);
  const key = String(column.key) as keyof typeof row;
  return String(row[key] ?? "-");
}

export function placeholderFor(tab: SettingsTabKey) {
  if (tab === "customers" || tab === "customerProducts") return "搜索客户简称 / 全称 / 国家";
  if (tab === "suppliers") return "搜索供应商 / 类型 / 联系人 / 税号";
  if (tab === "users") return "搜索姓名 / 邮箱";
  return "搜索操作人 / 动作 / 对象";
}
