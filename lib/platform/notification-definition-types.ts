import type { assertRead } from "./shared-access";
import type { writeAudit } from "./shared-audit";

export type ActorLike = Parameters<typeof assertRead>[0];
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type JsonRecord = Record<string, unknown>;
export type NotificationAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};
export type NotificationVariableDefinition = {
  key: string;
  label: string;
  required?: boolean;
};
export type NotificationTypeDefinition = {
  type: string;
  name: string;
  module: string;
  description: string;
  editable: boolean;
  supportsAttachments: boolean;
  securitySensitive?: boolean;
  defaultEnabled?: boolean;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: NotificationVariableDefinition[];
  recipientConfig?: JsonRecord;
  ccEmails?: string[];
  ccAdminEmails?: boolean;
  extraConfig?: JsonRecord;
};
export type SendNotificationEmailInput = {
  type: string;
  recipientEmails: unknown;
  ccEmails?: unknown;
  variables?: JsonRecord;
  attachments?: NotificationAttachment[];
  idempotencyKey?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  relatedOrderId?: string;
  context?: JsonRecord;
  subjectOverride?: string;
  bodyOverride?: string;
  htmlOverride?: string;
  ignoreTemplateCc?: boolean;
  ignoreTemplateEnabled?: boolean;
};

export const TEXT_LIMITS = {
  subject: 220,
  body: 16000,
  description: 600,
  error: 1000,
};

export const NOTIFICATION_TYPES = {
  USER_EMAIL_VERIFICATION: "USER_EMAIL_VERIFICATION",
  USER_LOGIN_ALERT: "USER_LOGIN_ALERT",
  SHIPPING_DOCUMENTS: "SHIPPING_DOCUMENTS",
  SHIPPING_DOCUMENTS_ZH: "SHIPPING_DOCUMENTS_ZH",
  SHIPPING_DOCUMENTS_RU: "SHIPPING_DOCUMENTS_RU",
  LOGISTICS_INVOICE_NOTICE: "LOGISTICS_INVOICE_NOTICE",
  SUPPLIER_DOCUMENT_REQUEST: "SUPPLIER_DOCUMENT_REQUEST",
  WORKBENCH_TODO_OVERDUE: "WORKBENCH_TODO_OVERDUE",
  FREIGHTOWER_TRACKING_UPDATE: "FREIGHTOWER_TRACKING_UPDATE",
  FREIGHTOWER_TRACKING_CUSTOMER_UPDATE: "FREIGHTOWER_TRACKING_CUSTOMER_UPDATE",
  FREIGHTOWER_PORT_ROLLOVER_ALERT: "FREIGHTOWER_PORT_ROLLOVER_ALERT",
  FREIGHTOWER_PORT_OPERATION_ALERT: "FREIGHTOWER_PORT_OPERATION_ALERT",
  FREIGHTOWER_CUSTOMS_ALERT: "FREIGHTOWER_CUSTOMS_ALERT",
} as const;

export const ENGLISH_TRACKING_NOTIFICATION_TYPES = new Set<string>([
  NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_CUSTOMER_UPDATE,
]);

export const CHINESE_TRACKING_NOTIFICATION_TYPES = new Set<string>([
  NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
  NOTIFICATION_TYPES.FREIGHTOWER_PORT_ROLLOVER_ALERT,
  NOTIFICATION_TYPES.FREIGHTOWER_PORT_OPERATION_ALERT,
  NOTIFICATION_TYPES.FREIGHTOWER_CUSTOMS_ALERT,
]);

export function logisticsEmailSubjectIsEnglish(value: unknown) {
  return /^[\x20-\x7e]+$/.test(String(value || ""));
}

export function logisticsEmailBodyIsEnglish(value: unknown) {
  const text = String(value || "").replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, "");
  const englishWords = text.match(/\b[A-Za-z]{3,}\b/g) || [];
  return englishWords.length >= 4 && !/[\u3400-\u9fff]/u.test(text);
}

export function logisticsEmailBodyIsChinese(value: unknown) {
  return /[\u3400-\u9fff]/u.test(String(value || "").replace(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g, ""));
}

export const COMMON_SIGNATURE = "NEXTWOOD 供应链协同平台";
