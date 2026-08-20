import type { CompanyProfileSettings } from "../../types";
import type { NotificationVariableDefinition } from "./types-integrations";
import type { BusinessEntityBankAccountFields, SettingsTabKey } from "./types-records";

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
  freightowerApiBaseUrl: string;
  freightowerApiKey: string;
  freightowerApiKeyConfigured: boolean;
  freightowerClientId: string;
  freightowerClientIdConfigured: boolean;
  freightowerApiSecret: string;
  freightowerApiSecretConfigured: boolean;
  freightowerIframeKey: string;
  freightowerIframeKeyConfigured: boolean;
  freightowerWebhookCallbackUrl: string;
  freightowerWebhookAccessSecret: string;
  freightowerWebhookAccessSecretConfigured: boolean;
  freightowerDefaultCarrierCode: string;
  freightowerDefaultPortCode: string;
  freightowerDefaultIsExport: string;
  freightowerDefaultLang: string;
  freightowerHiddenReference: boolean;
  oceanTrackingEnabled: boolean;
  customsTrackingEnabled: boolean;
  airTrackingEnabled: boolean;
  manualSyncEnabled: boolean;
  autoSyncEnabled: boolean;
  dailySyncTime: string;
  webhookEnabled: boolean;
  liveMapEnabled: boolean;
  customerPushEnabled: boolean;
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
  tencentSecretId: string;
  tencentSecretIdConfigured: boolean;
  tencentSecretKey: string;
  tencentSecretKeyConfigured: boolean;
  tencentRegion: string;
  invoiceTextEnabled: boolean;
  logisticsInvoiceEnabled: boolean;
  timeoutMs: string;
};

export type SmsIntegrationForm = {
  enabled: boolean;
  provider: "TENCENT_CLOUD";
  tencentSdkAppId: string;
  signName: string;
  templateId: string;
  region: string;
  secretId: string;
  secretIdConfigured: boolean;
  secretKey: string;
  secretKeyConfigured: boolean;
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
  purchasePaymentTerm: string;
  purchasePrepaymentPercent: string;
  purchaseQuantityTolerancePercent: string;
  purchasePrepaymentRequiredBeforeProduction: boolean;
  dispatchSmsEnabled: boolean;
  dispatchSmsPhone: string;
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
  nameEn: string;
  taxNumber: string;
  domesticBankName: string;
  domesticBankAccount: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  showContactPhoneOnPi: boolean;
  showContactEmailOnPi: boolean;
  showWebsiteOnPi: boolean;
  bankAccounts: Record<"CNY" | "USD", BusinessEntityBankAccountFields>;
  isDefault: boolean;
  status: string;
  sortOrder: string;
  remark: string;
};

export type UserForm = {
  id: string;
  expectedUpdatedAt: string;
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
