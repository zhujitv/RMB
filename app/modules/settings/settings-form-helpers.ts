import { FACTORY_SUPPLIER_ACCOUNT_ROLES, PRODUCT_SUPPLIER_TYPE, SHIPPING_DOCUMENT_TYPE_OPTIONS, USER_ROLES } from "./constants";
import type { BusinessEntityForm, BusinessEntityRow, CustomerForm, CustomerRow, PermissionConfig, SupplierForm, SupplierRow, UserForm, UserRow } from "./types";
import { emailListText, supplierTypeLabel } from "./settings-label-helpers";

export function emptyCustomerForm(): CustomerForm {
  return {
    id: "",
    name: "",
    shortName: "",
    country: "",
    defaultCurrency: "",
    salespersonUserId: "",
    commissionRate: "0",
    commissionStatus: "启用",
    contactPerson: "",
    contactEmail: "",
    contactPhone: "",
    enableAutoShippingDocsNotification: false,
    shippingDocsEmails: "",
    shippingDocsCcEmails: "",
    autoSendDocumentTypes: SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => option.value),
    clearanceEmailLanguage: "EN",
    remark: "",
  };
}

export function customerFormFromRow(customer: CustomerRow): CustomerForm {
  return {
    id: customer.id,
    name: customer.fullName || customer.name || "",
    shortName: customer.shortName || "",
    country: customer.country || "",
    defaultCurrency: customer.defaultCurrency || "",
    salespersonUserId: (customer as CustomerRow & { salespersonUserId?: string }).salespersonUserId || "",
    commissionRate: String(Number(customer.commissionRate || 0)),
    commissionStatus: customer.commissionStatus || "启用",
    contactPerson: customer.contactPerson || "",
    contactEmail: customer.contactEmail || "",
    contactPhone: customer.contactPhone || "",
    enableAutoShippingDocsNotification: Boolean(customer.enableAutoShippingDocsNotification),
    shippingDocsEmails: emailListText(customer.shippingDocsEmails),
    shippingDocsCcEmails: emailListText(customer.shippingDocsCcEmails),
    autoSendDocumentTypes: customer.autoSendDocumentTypes?.length
      ? customer.autoSendDocumentTypes
      : SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => option.value),
    clearanceEmailLanguage: customer.clearanceEmailLanguage || "EN",
    remark: customer.remark || "",
  };
}

export function emptySupplierForm(): SupplierForm {
  return {
    id: "",
    supplierName: "",
    supplierType: PRODUCT_SUPPLIER_TYPE,
    status: "启用",
    country: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    invoiceTitle: "",
    taxNumber: "",
    bankName: "",
    bankAccount: "",
    allowDomesticLogisticsEntry: false,
    allowLogisticsExpenseEntry: false,
    allowLogisticsInvoiceUpload: false,
    allowFactoryDocumentUpload: false,
    isDefaultLogisticsSupplier: false,
    allowedLogisticsCostTypes: [],
    remark: "",
  };
}

export function emptyBusinessEntityForm(): BusinessEntityForm {
  return {
    id: "",
    name: "",
    shortName: "",
    isDefault: false,
    status: "启用",
    sortOrder: "0",
    remark: "",
  };
}

export function businessEntityFormFromRow(entity: BusinessEntityRow): BusinessEntityForm {
  return {
    id: entity.id || "",
    name: entity.name || "",
    shortName: entity.shortName || "",
    isDefault: Boolean(entity.isDefault),
    status: entity.status || "启用",
    sortOrder: String(entity.sortOrder ?? 0),
    remark: entity.remark || "",
  };
}

export function supplierFormFromRow(supplier: SupplierRow): SupplierForm {
  return {
    id: supplier.id,
    supplierName: supplier.supplierName || "",
    supplierType: supplierTypeLabel(supplier.supplierType) || "其他供应商",
    status: supplier.status || "启用",
    country: supplier.country || "",
    contactPerson: supplier.contactPerson || "",
    phone: supplier.phone || "",
    email: supplier.email || "",
    address: supplier.address || "",
    invoiceTitle: supplier.invoiceTitle || "",
    taxNumber: supplier.taxNumber || "",
    bankName: supplier.bankName || "",
    bankAccount: supplier.bankAccount || "",
    allowDomesticLogisticsEntry: Boolean(supplier.allowDomesticLogisticsEntry),
    allowLogisticsExpenseEntry: Boolean(supplier.allowLogisticsExpenseEntry),
    allowLogisticsInvoiceUpload: Boolean(supplier.allowLogisticsInvoiceUpload),
    allowFactoryDocumentUpload: Boolean(supplier.allowFactoryDocumentUpload),
    isDefaultLogisticsSupplier: Boolean(supplier.isDefaultLogisticsSupplier),
    allowedLogisticsCostTypes: Array.isArray(supplier.allowedLogisticsCostTypes) ? supplier.allowedLogisticsCostTypes : [],
    remark: supplier.remark || "",
  };
}

export function emptyUserForm(): UserForm {
  return {
    id: "",
    expectedUpdatedAt: "",
    name: "",
    email: "",
    role: "业务员",
    approvalStatus: "APPROVED",
    supplierId: "",
    password: "",
    permissionMode: "ROLE",
    dataScope: "OWN",
    menus: [],
    reads: [],
    writes: [],
  };
}

export function userFormFromRow(user: UserRow): UserForm {
  const custom = user.customPermissions || null;
  const role = USER_ROLES.includes(user.role || "") ? String(user.role) : "业务员";
  return {
    id: user.id,
    expectedUpdatedAt: user.updatedAt || "",
    name: user.name || "",
    email: user.email || "",
    role,
    approvalStatus: user.approvalStatus || (user.isActive === false ? "DISABLED" : "APPROVED"),
    supplierId: user.supplierId || "",
    password: "",
    permissionMode: custom?.mode === "CUSTOM" || user.permissionMode === "CUSTOM" ? "CUSTOM" : "ROLE",
    dataScope: custom?.dataScope || "NONE",
    menus: Array.isArray(custom?.menus) ? custom.menus : [],
    reads: Array.isArray(custom?.reads) ? custom.reads : [],
    writes: Array.isArray(custom?.writes) ? custom.writes : [],
  };
}

export function permissionDefaultsForRole(config: PermissionConfig | null, role: string) {
  return {
    menus: config?.roleMenus?.[role] || [],
    reads: config?.roleReads?.[role] || [],
    writes: config?.roleWrites?.[role] || [],
    dataScope: defaultDataScopeForRole(role),
  };
}

export function defaultDataScopeForRole(role: string) {
  if (role === "管理员" || role === "财务") return "ALL";
  if (role === "业务员" || role === "物流供应商" || FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(role) || role === "物流资料录入员") return "OWN";
  return "NONE";
}

export function dataScopeLabel(config: PermissionConfig | null, value: string) {
  return config?.dataScopeOptions?.find((option) => option.value === value)?.label || value || "-";
}
