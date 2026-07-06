import type { CompanyProfileSettings } from "../../types";
import { COMMISSION_FORMULA_DEDUCTIONS, COMMISSION_FORMULA_PRESETS, COMMISSION_FORMULA_SOURCES, DEFAULT_NOTIFICATION_TEMPLATE_FORM, DEFAULT_OCR_INTEGRATION_FORM, DEFAULT_SHIPSGO_INTEGRATION_FORM, NOTIFICATION_RECIPIENT_EMAIL_OPTIONS } from "./constants";
import type { CommissionFormulaForm, CommissionFormulaSettings, CompanyProfileForm, ExchangeRateForm, ExchangeRateSettings, NotificationDeliveryLogRow, NotificationTemplateForm, NotificationTemplateRow, NotificationTemplateSettings, OcrIntegrationForm, OcrIntegrationSettings, ShipsgoIntegrationForm, ShipsgoIntegrationSettings } from "./types";

export function companyProfileFormFromSettings(settings: CompanyProfileSettings | null): CompanyProfileForm {
  return {
    brandName: stringSetting(settings, "brandName", "NEXTWOOD"),
    systemName: stringSetting(settings, "systemName", "NEXTWOOD 供应链协同平台"),
    companyNameZh: stringSetting(settings, "companyNameZh", "浙江莱诺建材有限公司"),
    companyNameEn: optionalStringSetting(settings, "companyNameEn"),
    shortName: stringSetting(settings, "shortName", "NEXTWOOD"),
    website: stringSetting(settings, "website", "https://www.nextwood.net"),
    contactEmail: stringSetting(settings, "contactEmail", ""),
    contactPhone: stringSetting(settings, "contactPhone", ""),
    address: stringSetting(settings, "address", ""),
    logoUrl: stringSetting(settings, "logoUrl", ""),
    footerText: optionalStringSetting(settings, "footerText"),
  };
}

export function exchangeFormFromSettings(settings: ExchangeRateSettings | null): ExchangeRateForm {
  return {
    source: stringSetting(settings, "source", "中国银行"),
    rateType: stringSetting(settings, "rateType", "现汇买入价"),
    autoUpdate: Boolean(settings?.autoUpdate),
    allowManualEdit: Boolean(settings?.allowManualEdit),
    allowMultipleOrderLogisticsSuppliers: Boolean(settings?.allowMultipleOrderLogisticsSuppliers),
    allowAdminIncompleteTaxSubmit: Boolean(settings?.allowAdminIncompleteTaxSubmit),
    paymentVoucherReminderStartDate: stringSetting(settings, "paymentVoucherReminderStartDate", "2026-06-30"),
  };
}

export function commissionFormulaFormFromSettings(settings: CommissionFormulaSettings | null): CommissionFormulaForm {
  const fallback = COMMISSION_FORMULA_PRESETS[0];
  const deductions = Array.isArray(settings?.deductions)
    ? settings.deductions.filter((item): item is string => typeof item === "string")
    : fallback.deductions;
  return {
    mode: stringSetting(settings, "mode", fallback.value),
    label: stringSetting(settings, "label", fallback.label),
    source: stringSetting(settings, "source", fallback.source),
    deductions,
    floorAtZero: settings?.floorAtZero !== false,
  };
}

export function notificationTemplateRows(settings: NotificationTemplateSettings | null): NotificationTemplateRow[] {
  return Array.isArray(settings?.templates) ? settings.templates : [];
}

export function notificationDeliveryLogs(settings: NotificationTemplateSettings | null): NotificationDeliveryLogRow[] {
  return Array.isArray(settings?.logs) ? settings.logs : [];
}

export function notificationTemplateFormFromTemplate(template: NotificationTemplateRow | null | undefined): NotificationTemplateForm {
  const row = template || DEFAULT_NOTIFICATION_TEMPLATE_FORM;
  return {
    type: String(row.type || DEFAULT_NOTIFICATION_TEMPLATE_FORM.type),
    name: String(row.name || DEFAULT_NOTIFICATION_TEMPLATE_FORM.name),
    module: String(row.module || DEFAULT_NOTIFICATION_TEMPLATE_FORM.module),
    description: String(row.description || ""),
    enabled: row.enabled !== false,
    editable: row.editable !== false,
    supportsAttachments: Boolean(row.supportsAttachments),
    securitySensitive: Boolean(row.securitySensitive),
    subjectTemplate: String(row.subjectTemplate || DEFAULT_NOTIFICATION_TEMPLATE_FORM.subjectTemplate),
    bodyTemplate: String(row.bodyTemplate || DEFAULT_NOTIFICATION_TEMPLATE_FORM.bodyTemplate),
    variables: Array.isArray(row.variables) ? row.variables : DEFAULT_NOTIFICATION_TEMPLATE_FORM.variables,
    recipientConfig: row.recipientConfig && typeof row.recipientConfig === "object" ? row.recipientConfig : {},
    extraConfig: row.extraConfig && typeof row.extraConfig === "object" ? row.extraConfig : {},
    ccAdminEmails: Boolean(row.ccAdminEmails),
    ccEmails: Array.isArray(row.ccEmails) ? row.ccEmails.join("\n") : "",
  };
}

export function notificationTemplateFormFromSettings(settings: NotificationTemplateSettings | null, selectedType = ""): NotificationTemplateForm {
  const rows = notificationTemplateRows(settings);
  const selected = rows.find((row) => row.type === selectedType) || rows[0] || null;
  return notificationTemplateFormFromTemplate(selected);
}

export function shipsgoIntegrationFormFromSettings(settings: ShipsgoIntegrationSettings | null): ShipsgoIntegrationForm {
  return {
    enabled: settings?.enabled === true,
    apiBaseUrl: stringSetting(settings, "apiBaseUrl", DEFAULT_SHIPSGO_INTEGRATION_FORM.apiBaseUrl),
    apiKey: "",
    apiKeyConfigured: settings?.apiKeyConfigured === true,
    oceanTrackingEnabled: settings?.oceanTrackingEnabled !== false,
    airTrackingEnabled: settings?.airTrackingEnabled === true,
    manualSyncEnabled: settings?.manualSyncEnabled !== false,
    autoSyncEnabled: settings?.autoSyncEnabled === true,
    dailySyncTime: stringSetting(settings, "dailySyncTime", DEFAULT_SHIPSGO_INTEGRATION_FORM.dailySyncTime),
    webhookEnabled: settings?.webhookEnabled === true,
    webhookSecret: "",
    webhookSecretConfigured: settings?.webhookSecretConfigured === true,
    liveMapEnabled: settings?.liveMapEnabled === true,
    customerPushEnabled: settings?.customerPushEnabled === true,
    creditWarningThreshold: String(settings?.creditWarningThreshold ?? DEFAULT_SHIPSGO_INTEGRATION_FORM.creditWarningThreshold),
  };
}

export function ocrIntegrationFormFromSettings(settings: OcrIntegrationSettings | null): OcrIntegrationForm {
  return {
    enabled: settings?.enabled === true,
    provider: stringSetting(settings, "provider", DEFAULT_OCR_INTEGRATION_FORM.provider),
    apiBaseUrl: stringSetting(settings, "apiBaseUrl", DEFAULT_OCR_INTEGRATION_FORM.apiBaseUrl),
    accessKeyId: "",
    accessKeyIdConfigured: settings?.accessKeyIdConfigured === true,
    accessKeySecret: "",
    accessKeySecretConfigured: settings?.accessKeySecretConfigured === true,
    appCode: "",
    appCodeConfigured: settings?.appCodeConfigured === true,
    invoiceTextEnabled: settings?.invoiceTextEnabled === true,
    supplierDocumentReturnEnabled: settings?.supplierDocumentReturnEnabled === true,
    logisticsInvoiceEnabled: settings?.logisticsInvoiceEnabled === true,
    timeoutMs: String(settings?.timeoutMs ?? DEFAULT_OCR_INTEGRATION_FORM.timeoutMs),
  };
}

export function commissionFormulaPreview(form: CommissionFormulaForm) {
  const sourceLabel = COMMISSION_FORMULA_SOURCES.find((item) => item.value === form.source)?.label || form.source;
  const deductionLabels = form.deductions
    .map((deduction) => COMMISSION_FORMULA_DEDUCTIONS.find((item) => item.value === deduction)?.label || deduction)
    .filter(Boolean);
  return [sourceLabel, ...deductionLabels.map((label) => `- ${label}`)].join(" ");
}

export function notificationTemplatePreview(form: NotificationTemplateForm) {
  const extraConfig = form.extraConfig || {};
  const recipientEmailFields = Array.isArray(extraConfig.recipientEmailFields)
    ? extraConfig.recipientEmailFields
    : Array.isArray(form.recipientConfig?.recipientEmailFields)
      ? form.recipientConfig.recipientEmailFields as string[]
      : [];
  const uploadUrl = String(extraConfig.uploadUrl || "https://www.nextwood.net");
  const recipientLabels = recipientEmailFields
    .map((value) => NOTIFICATION_RECIPIENT_EMAIL_OPTIONS.find((item) => item.value === value)?.label || "")
    .filter(Boolean)
    .join("、") || "按业务规则解析";
  const extraCcText = form.ccEmails
    .split(/[\n,;；]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("、");
  const ccText = [
    form.ccAdminEmails ? "管理员邮箱" : "未默认抄送管理员",
    extraCcText ? `额外抄送：${extraCcText}` : "",
  ].filter(Boolean).join("；");
  const sampleBillRows = [
    "1. 订单号：PV252",
    "   提单号：STSHVS76979",
    "   柜型/柜量：40HQ×1",
    "   客户简称：TERRAVUD",
    "   费用合计：",
    "   - 人民币实际费用合计：CNY ¥3,450.00",
    "   - USD 外币费用合计：USD $1,825.00",
    "   - 折人民币总合计：CNY ¥15,643.75",
    "   费用明细：",
    "   - 1. 拖车费，数量 1，CNY 2650.00，折人民币 ¥2650.00，备注：2650*1",
    "   - 2. 港杂费，数量 1，CNY 800.00，折人民币 ¥800.00",
    "   - 3. 海运费，数量 1，USD 1790.00，折人民币 ¥11959.30",
    "   - 4. ENS费，数量 1，USD 35.00，折人民币 ¥234.45",
    "   请分别上传：",
    "   - 港杂费发票：CNY ¥800.00",
    "   - 海运费发票：USD $1,825.00 / 折人民币 CNY ¥12,193.75",
    "   - 拖车及其他费用合并发票：CNY ¥2,650.00",
  ].join("\n");
  const variables: Record<string, string> = {
    name: "张三",
    verifyUrl: "https://www.nextwood.net/api/auth/verify-email?token=example",
    customerName: "ABC Customer",
    supplierName: "浙江迈奇克国际货运代理有限公司",
    billCount: "1",
    orderNo: "PV252",
    blNo: "STSHVS76979",
    customerShortName: "TERRAVUD",
    containerSummary: "40HQ×1",
    amountCny: "CNY ¥15,643.75",
    expenseDetails: "1. 拖车费，数量 1，CNY 2650.00，折人民币 ¥2650.00\n2. 海运费，数量 1，USD 1790.00，折人民币 ¥11959.30",
    invoiceGroups: "港杂费发票：CNY ¥800.00\n海运费发票：USD $1,825.00 / 折人民币 CNY ¥12,193.75\n拖车及其他费用合并发票：CNY ¥2,650.00",
    remark: "2650*1",
    billRows: sampleBillRows,
    invoiceRequirements: String(extraConfig.invoiceRequirements || ""),
    uploadUrl,
    signature: String(extraConfig.signature || "NEXTWOOD 供应链协同平台"),
    documentLines: "- Commercial Invoice\n- Packing List\n- Customs Declaration",
    customsDeclarationDate: "2026-07-01",
    requiredDocumentLines: "    * 工厂采购合同\n    * 工厂增值税发票",
    dueDate: "2026-07-08",
    sampleInstruction: "1. 本邮件已附上预填好的 Excel 合同样本，请打印合同并加盖公司公章，扫描后回传。",
    paymentVoucherInstruction: "5. 已付款的汇款水单已随邮件附件发送，请核对后回传对应资料。",
    messageBlock: "补充说明\n\n请优先回传盖章合同。",
    companyName: "浙江莱诺",
    ownerName: "李四",
    todoTitle: "物流费用待审核",
    module: "物流费用",
    dueAt: "2026-07-01 23:59",
    overdueDays: "6",
    actionUrl: "https://www.nextwood.net/workbench",
  };
  const subject = applyNotificationTemplate(form.subjectTemplate, variables);
  const body = applyNotificationTemplate(form.bodyTemplate, variables);
  return [`邮件类型：${form.name}`, `收件来源：${recipientLabels}`, `抄送：${ccText}`, "", `标题：${subject}`, "", body].join("\n");
}

export function applyNotificationTemplate(template: string, variables: Record<string, string>) {
  return String(template || "").replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match
  ));
}

export function stringSetting(settings: Record<string, unknown> | null | undefined, key: string, fallback: string) {
  const value = settings?.[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function optionalStringSetting(settings: Record<string, unknown> | null | undefined, key: string) {
  const value = settings?.[key];
  return typeof value === "string" ? value : "";
}

export function templateStringSetting(settings: Record<string, unknown> | null | undefined, key: string, fallback: string) {
  const value = settings?.[key];
  return typeof value === "string" ? value : fallback;
}

export function stringArraySetting(settings: Record<string, unknown> | null | undefined, key: string, fallback: string[]) {
  const value = settings?.[key];
  if (!Array.isArray(value)) return fallback;
  const result = value
    .map((item) => String(item || "").trim())
    .filter((item, index, arr) => item && arr.indexOf(item) === index);
  return result.length ? result : fallback;
}

export function emailListSettingText(settings: Record<string, unknown> | null | undefined, key: string) {
  const value = settings?.[key];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).join("\n");
  }
  return typeof value === "string" ? value : "";
}
