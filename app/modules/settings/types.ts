import type { CompanyProfileSettings } from "../../types";

export type SettingsTabKey = "home" | "companyProfile" | "businessEntities" | "customers" | "suppliers" | "users" | "ocrIntegration" | "shipsgoIntegration" | "exchangeRates" | "commissionFormula" | "notificationTemplates" | "auditLogs" | "apiPerformance";

export type SettingsFilters = {
  customers: {
    keyword: string;
  };
  suppliers: {
    keyword: string;
    type: string;
    status: string;
  };
  users: {
    keyword: string;
    role: string;
    status: string;
  };
  auditLogs: {
    keyword: string;
    action: string;
  };
  apiPerformance: {
    keyword: string;
    source: string;
    minDurationMs: string;
    windowHours: string;
  };
};

export type FiltersFor<T extends SettingsTabKey> =
  T extends "customers" ? SettingsFilters["customers"]
    : T extends "suppliers" ? SettingsFilters["suppliers"]
      : T extends "users" ? SettingsFilters["users"]
        : T extends "auditLogs" ? SettingsFilters["auditLogs"]
          : T extends "apiPerformance" ? SettingsFilters["apiPerformance"]
            : never;

export type TableColumn<T> = {
  key: keyof T | string;
  label: string;
  render?: (row: T) => string;
};

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type UserLite = {
  name?: string;
  role?: string;
};

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

export type SalespersonOption = {
  id: string;
  name?: string;
  role?: string;
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
  displayName?: string;
  isDefault?: boolean;
  status?: string;
  sortOrder?: number;
  remark?: string;
};

export type UserRow = {
  id: string;
  name?: string;
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

export type ApiPerformanceRow = {
  id: string;
  source?: string;
  method?: string;
  path?: string;
  count?: number;
  avgDurationMs?: number;
  p95DurationMs?: number;
  maxDurationMs?: number;
  errorCount?: number;
  lastStatusCode?: number | null;
  lastSeenAt?: string;
};

export type ExchangeRateSettings = Record<string, unknown>;
export type CommissionFormulaSettings = Record<string, unknown>;
export type NotificationVariableDefinition = {
  key: string;
  label: string;
  required?: boolean;
};

export type NotificationTemplateRow = {
  id: string;
  type: string;
  name: string;
  module: string;
  description: string;
  enabled: boolean;
  editable: boolean;
  supportsAttachments: boolean;
  securitySensitive: boolean;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: NotificationVariableDefinition[];
  recipientConfig: Record<string, unknown>;
  ccEmails: string[];
  ccAdminEmails: boolean;
  extraConfig: Record<string, unknown>;
  updatedAt?: string | null;
};

export type NotificationDeliveryLogRow = {
  id: string;
  outboxId: string;
  type: string;
  templateName: string;
  module: string;
  status: string;
  recipientEmails: string[];
  ccEmails: string[];
  subject: string;
  bodyPreview: string;
  relatedEntityType: string;
  relatedEntityId: string;
  relatedOrderId: string;
  errorMessage: string;
  provider: string;
  sentAt?: string | null;
  createdAt?: string | null;
};

export type NotificationTemplateSettings = {
  templates?: NotificationTemplateRow[];
  logs?: NotificationDeliveryLogRow[];
  types?: Array<Record<string, unknown>>;
} & Record<string, unknown>;
export type OcrIntegrationSettings = Record<string, unknown>;
export type ShipsgoIntegrationSettings = Record<string, unknown>;

export type LogisticsInvoiceValidationRule = {
  label: string;
  keywords: string[];
};

export type LogisticsInvoiceValidationRules = Record<string, LogisticsInvoiceValidationRule>;

export type ExchangeRateForm = {
  source: string;
  rateType: string;
  autoUpdate: boolean;
  allowManualEdit: boolean;
  allowMultipleOrderLogisticsSuppliers: boolean;
  allowAdminIncompleteTaxSubmit: boolean;
  paymentVoucherReminderStartDate: string;
};

export type CommissionFormulaForm = {
  mode: string;
  label: string;
  source: string;
  deductions: string[];
  floorAtZero: boolean;
};

export type NotificationTemplateForm = {
  type: string;
  name: string;
  module: string;
  description: string;
  enabled: boolean;
  editable: boolean;
  supportsAttachments: boolean;
  securitySensitive: boolean;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: NotificationVariableDefinition[];
  recipientConfig: Record<string, unknown>;
  extraConfig: Record<string, unknown>;
  ccAdminEmails: boolean;
  ccEmails: string;
};

export type ShipsgoIntegrationForm = {
  enabled: boolean;
  activeProvider: string;
  apiBaseUrl: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  shipsgoEnabled: boolean;
  freightowerEnabled: boolean;
  freightowerApiBaseUrl: string;
  freightowerClientId: string;
  freightowerClientIdConfigured: boolean;
  freightowerSecret: string;
  freightowerSecretConfigured: boolean;
  freightowerMapKey: string;
  freightowerMapKeyConfigured: boolean;
  freightowerWebhookSecret: string;
  freightowerWebhookSecretConfigured: boolean;
  freightowerDefaultCarrierCode: string;
  freightowerDefaultPortCode: string;
  freightowerDefaultIsExport: string;
  freightowerDefaultLang: string;
  freightowerHiddenReference: boolean;
  oceanTrackingEnabled: boolean;
  airTrackingEnabled: boolean;
  manualSyncEnabled: boolean;
  autoSyncEnabled: boolean;
  dailySyncTime: string;
  webhookEnabled: boolean;
  webhookSecret: string;
  webhookSecretConfigured: boolean;
  liveMapEnabled: boolean;
  customerPushEnabled: boolean;
  creditWarningThreshold: string;
};

export type OcrIntegrationForm = {
  enabled: boolean;
  provider: string;
  apiBaseUrl: string;
  accessKeyId: string;
  accessKeyIdConfigured: boolean;
  accessKeySecret: string;
  accessKeySecretConfigured: boolean;
  appCode: string;
  appCodeConfigured: boolean;
  invoiceTextEnabled: boolean;
  logisticsInvoiceEnabled: boolean;
  timeoutMs: string;
};

export type CompanyProfileForm = {
  brandName: string;
  systemName: string;
  companyNameZh: string;
  companyNameEn: string;
  shortName: string;
  website: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  logoUrl: string;
  footerText: string;
};

export type PermissionOption = {
  value: string;
  label: string;
};

export type PermissionConfig = {
  permissionModes?: PermissionOption[];
  dataScopeOptions?: PermissionOption[];
  menuPermissionOptions?: PermissionOption[];
  readPermissionOptions?: PermissionOption[];
  writePermissionOptions?: PermissionOption[];
  roleMenus?: Record<string, string[]>;
  roleReads?: Record<string, string[]>;
  roleWrites?: Record<string, string[]>;
};

export type UserCustomPermissions = {
  mode?: string;
  menus?: string[];
  reads?: string[];
  writes?: string[];
  dataScope?: string;
};

export type CustomerForm = {
  id: string;
  name: string;
  shortName: string;
  country: string;
  defaultCurrency: string;
  salespersonUserId: string;
  commissionRate: string;
  commissionStatus: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  enableAutoShippingDocsNotification: boolean;
  shippingDocsEmails: string;
  shippingDocsCcEmails: string;
  autoSendDocumentTypes: string[];
  clearanceEmailLanguage: string;
  remark: string;
};

export type SupplierForm = {
  id: string;
  supplierName: string;
  supplierType: string;
  status: string;
  country: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  invoiceTitle: string;
  taxNumber: string;
  bankName: string;
  bankAccount: string;
  allowDomesticLogisticsEntry: boolean;
  allowLogisticsExpenseEntry: boolean;
  allowLogisticsInvoiceUpload: boolean;
  allowFactoryDocumentUpload: boolean;
  isDefaultLogisticsSupplier: boolean;
  allowedLogisticsCostTypes: string[];
  remark: string;
};

export type BusinessEntityForm = {
  id: string;
  name: string;
  shortName: string;
  isDefault: boolean;
  status: string;
  sortOrder: string;
  remark: string;
};

export type UserForm = {
  id: string;
  name: string;
  email: string;
  role: string;
  approvalStatus: string;
  supplierId: string;
  password: string;
  permissionMode: string;
  dataScope: string;
  menus: string[];
  reads: string[];
  writes: string[];
};

export type SettingsModuleProps = {
  initialTab?: SettingsTabKey;
  initialTabToken?: number;
  currentUser?: { role?: string } | null;
  onCompanyProfileSaved?: (settings: CompanyProfileSettings) => void;
};
