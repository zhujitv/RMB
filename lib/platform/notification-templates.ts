// @ts-nocheck
import { prisma } from "../prisma";
import {
  DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
  LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY,
  LOGISTICS_INVOICE_NOTIFICATION_VARIABLES,
  runNonCriticalTask,
} from "./shared-constants";
import { assertJsonObject, nonEmpty } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";

const TEXT_LIMITS = {
  subject: 220,
  body: 12000,
  requirements: 4000,
  uploadUrl: 300,
  signature: 180,
};

function cleanTemplateText(value, fallback = "", limit = 1000) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
  return text || fallback;
}

function cleanOptionalUrl(value) {
  const text = cleanTemplateText(value, "", TEXT_LIMITS.uploadUrl);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function logisticsInvoiceNotificationUploadUrl(settings = {}) {
  return settings.uploadUrl || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://www.nextwood.net";
}

export function normalizeLogisticsInvoiceNotificationSettings(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
    autoSendOnApproval: input.autoSendOnApproval !== false,
    singleSubjectTemplate: cleanTemplateText(
      input.singleSubjectTemplate,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.singleSubjectTemplate,
      TEXT_LIMITS.subject,
    ),
    batchSubjectTemplate: cleanTemplateText(
      input.batchSubjectTemplate,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.batchSubjectTemplate,
      TEXT_LIMITS.subject,
    ),
    bodyTemplate: cleanTemplateText(
      input.bodyTemplate,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.bodyTemplate,
      TEXT_LIMITS.body,
    ),
    invoiceRequirements: cleanTemplateText(
      input.invoiceRequirements,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.invoiceRequirements,
      TEXT_LIMITS.requirements,
    ),
    uploadUrl: cleanOptionalUrl(input.uploadUrl),
    signature: cleanTemplateText(
      input.signature,
      DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS.signature,
      TEXT_LIMITS.signature,
    ),
    variables: LOGISTICS_INVOICE_NOTIFICATION_VARIABLES,
  };
}

export function serializeLogisticsInvoiceNotificationSetting(setting) {
  return normalizeLogisticsInvoiceNotificationSettings(setting?.value || setting || {});
}

export async function getLogisticsInvoiceNotificationSettings() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY } });
  if (setting) return serializeLogisticsInvoiceNotificationSetting(setting);
  const created = await prisma.systemSetting.create({
    data: {
      key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY,
      value: DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
    },
  });
  return serializeLogisticsInvoiceNotificationSetting(created);
}

export async function readLogisticsInvoiceNotificationSettings(actor) {
  assertRead(actor, "settings");
  return getLogisticsInvoiceNotificationSettings();
}

export async function saveLogisticsInvoiceNotificationSettings(request, actor, input = {}) {
  assertWrite(actor, "settings");
  const data = assertJsonObject(input);
  const value = data.resetToDefault === true
    ? normalizeLogisticsInvoiceNotificationSettings(DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS)
    : normalizeLogisticsInvoiceNotificationSettings(data);
  const before = await prisma.systemSetting.findUnique({ where: { key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY } });
  const setting = await prisma.systemSetting.upsert({
    where: { key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY },
    update: { value },
    create: { key: LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY, value },
  });
  await runNonCriticalTask("物流费用通知模板操作日志写入", () => (
    writeAudit(request, actor, "更新物流费用通知模板", "system_settings", LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY, before, setting)
  ));
  return serializeLogisticsInvoiceNotificationSetting(setting);
}

function formatCurrencyCny(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function templateValue(value) {
  return nonEmpty(value) || "-";
}

function applyTemplate(template = "", variables = {}) {
  return String(template || "").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? "") : match
  ));
}

function billVariables(bill = {}) {
  return {
    orderNo: templateValue(bill.orderNo),
    blNo: templateValue(bill.blNo),
    customerShortName: templateValue(bill.customerShortName),
    containerSummary: templateValue(bill.containerSummary || "未录入"),
    amountCny: formatCurrencyCny(bill.amountCny),
    expenseDetails: templateValue(bill.detailText),
    invoiceGroups: (bill.invoiceGroups || []).map((group) => group.label).filter(Boolean).join("\n") || "对应物流费用发票",
    remark: templateValue(bill.remark),
  };
}

function defaultBillRows(bills = []) {
  return bills.map((bill, index) => {
    const variables = billVariables(bill);
    const invoiceGroups = variables.invoiceGroups.split("\n").map((line) => `   - ${line}`).join("\n");
    const detailLines = String(variables.expenseDetails || "-").split("\n").map((line) => `   - ${line}`).join("\n");
    return [
      `${index + 1}. 订单号：${variables.orderNo}`,
      `   提单号：${variables.blNo}`,
      `   柜型/柜量：${variables.containerSummary}`,
      `   客户简称：${variables.customerShortName}`,
      `   费用合计：${variables.amountCny}`,
      "   费用明细：",
      detailLines,
      "   请分别上传：",
      invoiceGroups,
      `   备注：${variables.remark}`,
    ].join("\n");
  }).join("\n\n");
}

export async function renderLogisticsInvoiceNotificationEmail(supplierName = "供应商", bills = []) {
  const settings = await getLogisticsInvoiceNotificationSettings();
  const firstBill = bills[0] || {};
  const firstBillVariables = billVariables(firstBill);
  const uploadUrl = logisticsInvoiceNotificationUploadUrl(settings);
  const variables = {
    ...firstBillVariables,
    supplierName: templateValue(supplierName),
    billCount: String(bills.length || 0),
    billRows: defaultBillRows(bills),
    invoiceRequirements: settings.invoiceRequirements,
    uploadUrl,
    signature: settings.signature,
  };
  const subjectTemplate = bills.length === 1 ? settings.singleSubjectTemplate : settings.batchSubjectTemplate;
  return {
    subject: applyTemplate(subjectTemplate, variables),
    body: applyTemplate(settings.bodyTemplate, variables),
    settings,
  };
}
