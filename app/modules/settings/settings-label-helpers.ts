import { FACTORY_SUPPLIER_ACCOUNT_ROLES, LOGISTICS_SUPPLIER_TYPE_CODE, LOGISTICS_SUPPLIER_TYPES, PRODUCT_SUPPLIER_TYPE, PRODUCT_SUPPLIER_TYPES, SHIPPING_DOCUMENT_TYPE_OPTIONS, SUPPLIER_ACCOUNT_ROLES } from "./constants";
import type { PermissionConfig, SalespersonOption, SupplierRow, UserRow } from "./types";

export function approvalStatusText(status: unknown) {
  if (status === "APPROVED") return "已启用";
  if (status === "PENDING") return "待审核";
  if (status === "REJECTED") return "已拒绝";
  if (status === "DISABLED") return "已停用";
  return String(status || "-");
}

export function userStatus(user: UserRow) {
  if (user.emailVerified === false) return "未验证";
  if (user.approvalStatus === "APPROVED" && user.isActive !== false) return "已启用";
  if (user.approvalStatus === "PENDING") return "待审核";
  if (user.approvalStatus === "REJECTED") return "已拒绝";
  if (user.approvalStatus === "DISABLED" || user.isActive === false) return "已停用";
  return user.approvalStatus || "-";
}

export function apiPerformanceSourceLabel(source: unknown) {
  if (source === "server") return "服务端包装器";
  if (source === "client") return "前端真实请求";
  if (source === "background") return "后台任务";
  return source ? String(source) : "-";
}

export function supplierDisplayName(user: UserRow) {
  const name = user.supplierName || "";
  const type = supplierTypeLabel(user.supplierType);
  if (name && type) return `${name} / ${type}`;
  return name || type || "";
}

export function isSupplierAccountRole(role: unknown) {
  return SUPPLIER_ACCOUNT_ROLES.includes(String(role || ""));
}

export function supplierMatchesUserRole(supplier: SupplierRow | undefined, role: string) {
  if (!supplier) return false;
  if (role === "物流供应商") return LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType || "");
  if (FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(role)) return PRODUCT_SUPPLIER_TYPES.includes(supplier.supplierType || "");
  return false;
}

export function supplierOptionLabel(supplier: SupplierRow) {
  const name = supplier.supplierName || "未命名供应商";
  const type = supplierTypeLabel(supplier.supplierType);
  return type ? `${name} / ${type}` : name;
}

export function supplierTypeLabel(value: unknown) {
  const supplierType = String(value || "");
  if (PRODUCT_SUPPLIER_TYPES.includes(supplierType)) return PRODUCT_SUPPLIER_TYPE;
  if (supplierType === LOGISTICS_SUPPLIER_TYPE_CODE) return "物流供应商";
  return supplierType;
}

export function salespersonOptionLabel(user: SalespersonOption) {
  return user.role ? `${user.name || "未命名用户"} / ${user.role}` : (user.name || "未命名用户");
}

export function fuzzyIncludes(values: unknown[], keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(normalized));
}

export function emailListText(value?: string[] | string) {
  if (Array.isArray(value)) return value.join("\n");
  return value || "";
}

export function shippingDocumentTypeLabels(value?: string[]) {
  const selected = value?.length ? value : SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => option.value);
  return selected
    .map((item) => SHIPPING_DOCUMENT_TYPE_OPTIONS.find((option) => option.value === item)?.label || item)
    .join("、");
}
