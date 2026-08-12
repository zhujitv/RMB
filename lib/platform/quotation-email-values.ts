import { TEXT_LIMITS, type NotificationVariableDefinition } from "./notification-definition-types";
import {
  assertJsonObject,
  codedError,
  nonEmpty,
  parseEmailList,
  requireValidEmailList,
  validEmail,
} from "./shared-base-utils";

export const QUOTATION_CUSTOMER_EMAIL_SUBJECT_TEMPLATE = "Quotation {quoteNo} - Version {versionNumber}";

export const QUOTATION_CUSTOMER_EMAIL_BODY_TEMPLATE = [
  "Dear {customerName},",
  "",
  "Please find attached our quotation {quoteNo} (Version {versionNumber}) for your review.",
  "",
  "Quotation summary:",
  "- Quotation No.: {quoteNo}",
  "- Version: {versionNumber}",
  "- Total Amount: {currency} {totalAmount}",
  "",
  "Please review the attached PDF and contact us if you have any questions.",
  "",
  "Best regards,",
  "{salespersonName}",
  "{sellerName}",
].join("\n");

export const QUOTATION_CUSTOMER_EMAIL_VARIABLES: NotificationVariableDefinition[] = [
  { key: "quoteNo", label: "Quotation number", required: true },
  { key: "customerName", label: "Customer name", required: true },
  { key: "versionNumber", label: "Quotation version", required: true },
  { key: "totalAmount", label: "Total amount", required: true },
  { key: "currency", label: "Currency", required: true },
  { key: "salespersonName", label: "Salesperson name" },
  { key: "sellerName", label: "Seller legal name", required: true },
];

export type QuotationEmailDraftSource = {
  quoteNo?: unknown;
  customerName?: unknown;
  customerNameSnapshot?: unknown;
  contactEmail?: unknown;
  contactEmailSnapshot?: unknown;
  recipientEmails?: unknown;
  ccEmails?: unknown;
  versionNumber?: unknown;
  totalAmount?: unknown;
  currency?: unknown;
  salespersonName?: unknown;
  sellerName?: unknown;
  sellerNameEnSnapshot?: unknown;
  businessEntityNameSnapshot?: unknown;
};

export type QuotationEmailDraft = {
  recipientEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  variables: Record<string, string>;
};

export type NormalizedQuotationEmailSendInput = {
  recipientEmails: string[];
  ccEmails: string[];
  subject: string;
  body: string;
  requestKey: string;
};

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNSAFE_BODY_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_EMAIL_LENGTH = 254;
const MAX_TO_RECIPIENTS = 5;
const MAX_CC_RECIPIENTS = 10;
const MAX_TOTAL_RECIPIENTS = 15;

function firstText(values: unknown[], fallback: string) {
  for (const value of values) {
    const text = nonEmpty(value);
    if (text) return text;
  }
  return fallback;
}

function applyQuotationEmailTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match
  ));
}

export function quotationEmailTemplateVariables(source: QuotationEmailDraftSource = {}) {
  return {
    quoteNo: firstText([source.quoteNo], "-"),
    customerName: firstText([source.customerNameSnapshot, source.customerName], "Customer"),
    versionNumber: firstText([source.versionNumber], "-"),
    totalAmount: firstText([source.totalAmount], "0.00"),
    currency: firstText([source.currency], ""),
    salespersonName: firstText([source.salespersonName], "NEXTWOOD Sales Team"),
    sellerName: firstText(
      [source.sellerNameEnSnapshot, source.businessEntityNameSnapshot, source.sellerName],
      "NEXTWOOD",
    ),
  };
}

function defaultQuotationEmailAddressList(value: unknown) {
  return parseEmailList(value).filter((email) => email.length <= MAX_EMAIL_LENGTH && validEmail(email));
}

export function normalizeQuotationEmailAddressList(
  value: unknown,
  label: string,
  required = false,
  maxCount = MAX_TOTAL_RECIPIENTS,
) {
  const emails = requireValidEmailList(value, label);
  if (emails.some((email) => email.length > MAX_EMAIL_LENGTH)) {
    throw codedError(`${label}中存在超过 ${MAX_EMAIL_LENGTH} 个字符的地址`, 400, "QUOTATION_EMAIL_ADDRESS_TOO_LONG");
  }
  if (required && !emails.length) {
    throw codedError(`${label}不能为空`, 400, "QUOTATION_EMAIL_RECIPIENT_REQUIRED");
  }
  if (emails.length > maxCount) {
    const code = maxCount === MAX_TO_RECIPIENTS
      ? "QUOTATION_EMAIL_TO_LIMIT_EXCEEDED"
      : "QUOTATION_EMAIL_CC_LIMIT_EXCEEDED";
    throw codedError(`${label}最多允许 ${maxCount} 个地址`, 400, code);
  }
  return emails;
}

export function normalizeQuotationEmailSubject(value: unknown) {
  const subject = nonEmpty(value);
  if (!subject) {
    throw codedError("邮件标题不能为空", 400, "QUOTATION_EMAIL_SUBJECT_REQUIRED");
  }
  if (/[\r\n]/.test(subject)) {
    throw codedError("邮件标题不能包含换行符", 400, "QUOTATION_EMAIL_SUBJECT_INVALID");
  }
  if (subject.length > TEXT_LIMITS.subject) {
    throw codedError(`邮件标题不能超过 ${TEXT_LIMITS.subject} 个字符`, 400, "QUOTATION_EMAIL_SUBJECT_TOO_LONG");
  }
  return subject;
}

export function normalizeQuotationEmailBody(value: unknown) {
  const body = nonEmpty(value);
  if (!body) {
    throw codedError("邮件正文不能为空", 400, "QUOTATION_EMAIL_BODY_REQUIRED");
  }
  if (UNSAFE_BODY_CONTROL_PATTERN.test(body)) {
    throw codedError("邮件正文包含无效控制字符", 400, "QUOTATION_EMAIL_BODY_INVALID");
  }
  if (body.length > TEXT_LIMITS.body) {
    throw codedError(`邮件正文不能超过 ${TEXT_LIMITS.body} 个字符`, 400, "QUOTATION_EMAIL_BODY_TOO_LONG");
  }
  return body;
}

export function normalizeQuotationEmailRequestKey(value: unknown) {
  const requestKey = nonEmpty(value);
  if (!requestKey) {
    throw codedError("邮件发送请求标识不能为空", 400, "QUOTATION_EMAIL_REQUEST_KEY_REQUIRED");
  }
  if (!REQUEST_KEY_PATTERN.test(requestKey)) {
    throw codedError("邮件发送请求标识格式错误", 400, "QUOTATION_EMAIL_REQUEST_KEY_INVALID");
  }
  return requestKey;
}

export function buildQuotationEmailDefaultDraft(source: QuotationEmailDraftSource = {}): QuotationEmailDraft {
  const variables = quotationEmailTemplateVariables(source);
  const recipientSource = source.recipientEmails ?? source.contactEmailSnapshot ?? source.contactEmail ?? [];
  const recipientEmails = defaultQuotationEmailAddressList(recipientSource).slice(0, MAX_TO_RECIPIENTS);
  const recipientSet = new Set(recipientEmails);
  const ccEmails = defaultQuotationEmailAddressList(source.ccEmails ?? [])
    .filter((email) => !recipientSet.has(email))
    .slice(0, Math.min(MAX_CC_RECIPIENTS, MAX_TOTAL_RECIPIENTS - recipientEmails.length));
  return {
    recipientEmails,
    ccEmails,
    subject: applyQuotationEmailTemplate(QUOTATION_CUSTOMER_EMAIL_SUBJECT_TEMPLATE, variables),
    body: applyQuotationEmailTemplate(QUOTATION_CUSTOMER_EMAIL_BODY_TEMPLATE, variables),
    variables,
  };
}

export function normalizeQuotationEmailSendInput(
  input: unknown,
  defaults: QuotationEmailDraft | null = null,
): NormalizedQuotationEmailSendInput {
  const data = assertJsonObject(input, "报价邮件参数");
  const recipientEmails = normalizeQuotationEmailAddressList(
    Object.prototype.hasOwnProperty.call(data, "recipientEmails") ? data.recipientEmails : defaults?.recipientEmails,
    "收件邮箱",
    true,
    MAX_TO_RECIPIENTS,
  );
  const recipientSet = new Set(recipientEmails);
  const ccEmails = normalizeQuotationEmailAddressList(
    Object.prototype.hasOwnProperty.call(data, "ccEmails") ? data.ccEmails : defaults?.ccEmails,
    "抄送邮箱",
    false,
    MAX_CC_RECIPIENTS,
  ).filter((email) => !recipientSet.has(email));
  if (recipientEmails.length + ccEmails.length > MAX_TOTAL_RECIPIENTS) {
    throw codedError(`收件与抄送合计最多 ${MAX_TOTAL_RECIPIENTS} 个地址`, 400, "QUOTATION_EMAIL_TOTAL_LIMIT_EXCEEDED");
  }
  return {
    recipientEmails,
    ccEmails,
    subject: normalizeQuotationEmailSubject(
      Object.prototype.hasOwnProperty.call(data, "subject") ? data.subject : defaults?.subject,
    ),
    body: normalizeQuotationEmailBody(
      Object.prototype.hasOwnProperty.call(data, "body") ? data.body : defaults?.body,
    ),
    requestKey: normalizeQuotationEmailRequestKey(data.requestKey),
  };
}
