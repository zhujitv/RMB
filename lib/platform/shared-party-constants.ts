export const LOGISTICS_OPERATOR_ROLE = "物流供应商";
export const PRODUCT_SUPPLIER_TYPE = "产品供应商";
export const LEGACY_FACTORY_SUPPLIER_TYPE = "工厂供应商";
export const PRODUCT_SUPPLIER_TYPE_CODE = "PRODUCT";
export const LOGISTICS_SUPPLIER_TYPE_CODE = "LOGISTICS";
export const PRODUCT_SUPPLIER_OPERATOR_ROLE = "产品供应商";
export const LEGACY_PRODUCT_SUPPLIER_OPERATOR_ROLE = `${PRODUCT_SUPPLIER_OPERATOR_ROLE}账号`;
export const LEGACY_FACTORY_SUPPLIER_OPERATOR_ROLE = "工厂供应商账号";
export const FACTORY_SUPPLIER_OPERATOR_ROLE = PRODUCT_SUPPLIER_OPERATOR_ROLE;
export const PRODUCT_SUPPLIER_TYPES = [PRODUCT_SUPPLIER_TYPE, LEGACY_FACTORY_SUPPLIER_TYPE, PRODUCT_SUPPLIER_TYPE_CODE];
export const PRODUCT_SUPPLIER_OPERATOR_ROLES = [PRODUCT_SUPPLIER_OPERATOR_ROLE, LEGACY_PRODUCT_SUPPLIER_OPERATOR_ROLE, LEGACY_FACTORY_SUPPLIER_OPERATOR_ROLE];
export const LEGACY_LOGISTICS_OPERATOR_ROLE = "物流资料录入员";
export const ROLES = ["管理员", "业务员", "财务", LOGISTICS_OPERATOR_ROLE, FACTORY_SUPPLIER_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE];

export function isProductSupplierType(value: unknown = "") {
  return PRODUCT_SUPPLIER_TYPES.includes(String(value || ""));
}

export function isProductSupplierOperatorRole(value: unknown = "") {
  return PRODUCT_SUPPLIER_OPERATOR_ROLES.includes(String(value || ""));
}

export function supplierTypeDisplayName(value: unknown = "") {
  const supplierType = String(value || "");
  if (supplierType === LEGACY_FACTORY_SUPPLIER_TYPE || supplierType === PRODUCT_SUPPLIER_TYPE_CODE) return PRODUCT_SUPPLIER_TYPE;
  if (supplierType === LOGISTICS_SUPPLIER_TYPE_CODE) return "物流供应商";
  return supplierType;
}

export function userRoleDisplayName(value: unknown = "") {
  const role = String(value || "");
  return role === LEGACY_FACTORY_SUPPLIER_OPERATOR_ROLE || role === LEGACY_PRODUCT_SUPPLIER_OPERATOR_ROLE ? PRODUCT_SUPPLIER_OPERATOR_ROLE : role;
}

export function supplierTypeStorageValue(value: unknown = "") {
  const supplierType = String(value || "");
  if (supplierType === LEGACY_FACTORY_SUPPLIER_TYPE || supplierType === PRODUCT_SUPPLIER_TYPE_CODE) return PRODUCT_SUPPLIER_TYPE;
  if (supplierType === LOGISTICS_SUPPLIER_TYPE_CODE) return "物流供应商";
  return supplierType;
}
