export type ExchangeRateSettings = Record<string, unknown>;
export type CommissionFormulaSettings = Record<string, unknown>;
export type NotificationVariableDefinition = { key: string; label: string; required?: boolean };

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
  channel: string;
  status: string;
  recipientEmails: string[];
  recipientPhones: string[];
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
export type SmsIntegrationSettings = Record<string, unknown>;
export type CrmEmailIntegrationSettings = Record<string, unknown>;
export type LogisticsInvoiceValidationRule = { label: string; keywords: string[] };
export type LogisticsInvoiceValidationRules = Record<string, LogisticsInvoiceValidationRule>;
export type CustomsProductWhitelistEntry = {
  id: string;
  standardName: string;
  aliases: string[];
  hsCodes: string[];
  enabled: boolean;
};
export type PermissionOption = { value: string; label: string };

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
