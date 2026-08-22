import type { UserCustomPermissions } from "./types-integrations";

export type SettingsTabKey = "home" | "companyProfile" | "businessEntities" | "customers" | "customerProducts" | "suppliers" | "users" | "ocrIntegration" | "shipsgoIntegration" | "smsIntegration" | "crmEmailIntegration" | "exchangeRates" | "commissionFormula" | "notificationTemplates" | "auditLogs";

export type SettingsFilters = {
  customers: { keyword: string };
  suppliers: { keyword: string; type: string; status: string };
  users: { keyword: string; role: string; status: string };
  auditLogs: { keyword: string; action: string };
};

export type FiltersFor<T extends SettingsTabKey> =
  T extends "customers" | "customerProducts" ? SettingsFilters["customers"]
  : T extends "suppliers" ? SettingsFilters["suppliers"]
  : T extends "users" ? SettingsFilters["users"]
  : T extends "auditLogs" ? SettingsFilters["auditLogs"]
  : never;

export type TableColumn<T> = { key: keyof T | string; label: string; render?: (row: T) => string };
export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };
export type UserLite = { name?: string; role?: string };

export type CustomerRow = {
  id: string;
  shortName?: string;
  name?: string;
  fullName?: string;
  country?: string;
  defaultCurrency?: string;
  salespersonUserId?: string;
  salespersonName?: string;
  commissionRate?: number;
  commissionStatus?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  enableAutoShippingDocsNotification?: boolean;
  shippingDocsEmails?: string[];
  shippingDocsCcEmails?: string[];
  autoSendDocumentTypes?: string[];
  clearanceEmailLanguage?: string;
  clearanceEmailLanguageLabel?: string;
  remark?: string;
};

export type SalespersonOption = { id: string; name?: string; role?: string };

export type BusinessEntityBankAccountFields = {
  currency: "CNY" | "USD";
  beneficiaryName: string;
  beneficiaryAddress: string;
  bankName: string;
  accountNumber: string;
  swiftCode: string;
};

export type SupplierRow = {
  id: string;
  supplierName?: string;
  supplierType?: string;
  status?: string;
  country?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  invoiceTitle?: string;
  taxNumber?: string;
  bankName?: string;
  bankAccount?: string;
  purchasePaymentTerm?: string;
  purchasePrepaymentPercent?: string;
  purchaseQuantityTolerancePercent?: string;
  purchasePrepaymentRequiredBeforeProduction?: boolean;
  dispatchSmsEnabled?: boolean;
  dispatchSmsPhone?: string;
  allowDomesticLogisticsEntry?: boolean;
  allowLogisticsExpenseEntry?: boolean;
  allowLogisticsInvoiceUpload?: boolean;
  allowFactoryDocumentUpload?: boolean;
  isDefaultLogisticsSupplier?: boolean;
  allowedLogisticsCostTypes?: string[];
  remark?: string;
};

export type BusinessEntityRow = {
  id: string;
  name?: string;
  shortName?: string;
  nameEn?: string;
  taxNumber?: string;
  domesticBankName?: string;
  domesticBankAccount?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  showContactPhoneOnPi?: boolean;
  showContactEmailOnPi?: boolean;
  showWebsiteOnPi?: boolean;
  bankAccounts?: Partial<Record<"CNY" | "USD", BusinessEntityBankAccountFields>>;
  displayName?: string;
  isDefault?: boolean;
  status?: string;
  sortOrder?: number;
  remark?: string;
  hasElectronicSeal?: boolean;
  electronicSeal?: {
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    uploadedAt?: string | Date | null;
  } | null;
};

export type UserRow = {
  id: string;
  name?: string;
  englishName?: string;
  email?: string;
  role?: string;
  supplierId?: string;
  supplierName?: string;
  supplierType?: string;
  phone?: string;
  approvalStatus?: string;
  isActive?: boolean;
  emailVerified?: boolean;
  emailVerifiedAt?: string;
  passwordPolicyPassed?: boolean;
  createdAt?: string;
  updatedAt?: string;
  permissionMode?: string;
  customPermissions?: UserCustomPermissions | null;
  mustChangePassword?: boolean;
};

export type AuditLogRow = {
  id: string;
  user?: UserLite | null;
  action?: string;
  entityType?: string;
  entityLabel?: string;
  ipAddress?: string;
  createdAt?: string;
};
