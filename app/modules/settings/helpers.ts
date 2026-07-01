import type { CompanyProfileSettings } from "../../types";
import { formatDateTime, yesNo } from "../../formatters";
import {
  AUDIT_PAGE_SIZE,
  COMMISSION_FORMULA_DEDUCTIONS,
  COMMISSION_FORMULA_PRESETS,
  COMMISSION_FORMULA_SOURCES,
  DEFAULT_NOTIFICATION_TEMPLATE_FORM,
  DEFAULT_OCR_INTEGRATION_FORM,
  DEFAULT_SHIPSGO_INTEGRATION_FORM,
  FACTORY_SUPPLIER_ACCOUNT_ROLES,
  LOGISTICS_SUPPLIER_TYPE_CODE,
  LOGISTICS_SUPPLIER_TYPES,
  NOTIFICATION_RECIPIENT_EMAIL_OPTIONS,
  PRODUCT_SUPPLIER_TYPE,
  PRODUCT_SUPPLIER_TYPES,
  SETTINGS_TABS,
  SHIPPING_DOCUMENT_TYPE_OPTIONS,
  SUPPLIER_ACCOUNT_ROLES,
  USER_ROLES,
} from "./constants";
import type {
  ApiPerformanceRow,
  AuditLogRow,
  BusinessEntityForm,
  BusinessEntityRow,
  CommissionFormulaForm,
  CommissionFormulaSettings,
  CompanyProfileForm,
  CustomerForm,
  CustomerRow,
  ExchangeRateForm,
  ExchangeRateSettings,
  NotificationDeliveryLogRow,
  NotificationTemplateForm,
  NotificationTemplateRow,
  NotificationTemplateSettings,
  OcrIntegrationForm,
  OcrIntegrationSettings,
  Pagination,
  PermissionConfig,
  SettingsFilters,
  SettingsTabKey,
  ShipsgoIntegrationForm,
  ShipsgoIntegrationSettings,
  SalespersonOption,
  SupplierForm,
  SupplierRow,
  TableColumn,
  UserForm,
  UserRow,
} from "./types";

export const CUSTOMER_COLUMNS: TableColumn<CustomerRow>[] = [
  { key: "shortName", label: "客户简称", render: (row) => row.shortName || "-" },
  { key: "country", label: "国家" },
  { key: "defaultCurrency", label: "默认币种" },
  { key: "salespersonName", label: "负责业务员" },
  { key: "commissionStatus", label: "提成状态" },
];

export const SUPPLIER_COLUMNS: TableColumn<SupplierRow>[] = [
  { key: "supplierName", label: "供应商" },
  {
    key: "supplierType",
    label: "类型",
    render: (row) => supplierTypeLabel(row.supplierType) || "-",
  },
  { key: "status", label: "状态" },
  { key: "contactPerson", label: "联系人" },
  { key: "isDefaultLogisticsSupplier", label: "默认物流", render: (row) => LOGISTICS_SUPPLIER_TYPES.includes(row.supplierType || "") ? yesNo(row.isDefaultLogisticsSupplier) : "-" },
];

export const USER_COLUMNS: TableColumn<UserRow>[] = [
  { key: "name", label: "姓名" },
  { key: "email", label: "邮箱" },
  { key: "role", label: "角色" },
  { key: "supplierName", label: "所属供应商", render: (row) => isSupplierAccountRole(row.role) ? (supplierDisplayName(row) || "-") : "-" },
  { key: "emailVerified", label: "邮箱验证", render: (row) => row.emailVerified === false ? "未验证" : "已验证" },
  { key: "createdAt", label: "注册时间", render: (row) => formatDateTime(row.createdAt) },
  { key: "approvalStatus", label: "审核状态", render: (row) => approvalStatusText(row.approvalStatus) },
  { key: "accountStatus", label: "账号状态", render: (row) => userStatus(row) },
  { key: "permissionMode", label: "权限模式", render: (row) => row.permissionMode === "CUSTOM" ? "自定义" : "角色默认" },
];

export const AUDIT_COLUMNS: TableColumn<AuditLogRow>[] = [
  { key: "createdAt", label: "时间", render: (row) => formatDateTime(row.createdAt) },
  { key: "user", label: "操作人", render: (row) => row.user?.name || "-" },
  { key: "action", label: "动作" },
  { key: "entityLabel", label: "对象" },
  { key: "ipAddress", label: "IP" },
];

export const API_PERFORMANCE_COLUMNS: TableColumn<ApiPerformanceRow>[] = [
  { key: "path", label: "路径 / 任务" },
  { key: "method", label: "方法" },
  { key: "source", label: "来源", render: (row) => apiPerformanceSourceLabel(row.source) },
  { key: "count", label: "次数", render: (row) => String(row.count || 0) },
  { key: "avgDurationMs", label: "平均耗时", render: (row) => `${Number(row.avgDurationMs || 0)} ms` },
  { key: "p95DurationMs", label: "P95", render: (row) => `${Number(row.p95DurationMs || 0)} ms` },
  { key: "maxDurationMs", label: "最慢", render: (row) => `${Number(row.maxDurationMs || 0)} ms` },
  { key: "errorCount", label: "错误数", render: (row) => String(row.errorCount || 0) },
  { key: "lastSeenAt", label: "最近调用", render: (row) => formatDateTime(row.lastSeenAt) },
];

export function columnsFor(tab: SettingsTabKey) {
  if (tab === "customers") return CUSTOMER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>[];
  if (tab === "suppliers") return SUPPLIER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>[];
  if (tab === "users") return USER_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>[];
  if (tab === "apiPerformance") return API_PERFORMANCE_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>[];
  return AUDIT_COLUMNS as TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>[];
}

export function rowsFor(tab: SettingsTabKey, rows: {
  customers: CustomerRow[];
  suppliers: SupplierRow[];
  users: UserRow[];
  logs: AuditLogRow[];
  apiPerformance: ApiPerformanceRow[];
}) {
  if (tab === "customers") return rows.customers;
  if (tab === "suppliers") return rows.suppliers;
  if (tab === "users") return rows.users;
  if (tab === "auditLogs") return rows.logs;
  if (tab === "apiPerformance") return rows.apiPerformance;
  return [];
}

export function detailFieldsFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return [
      { label: "客户全称", value: customer.fullName || customer.name || "-", wide: true },
      { label: "客户简称", value: customer.shortName || "-" },
      { label: "国家", value: customer.country || "-" },
      { label: "默认币种", value: customer.defaultCurrency || "-" },
      { label: "负责业务员", value: customer.salespersonName || "-" },
      { label: "提成比例", value: `${Number(customer.commissionRate || 0).toFixed(2)}%` },
      { label: "联系人", value: customer.contactPerson || "-" },
      { label: "清关资料自动通知", value: yesNo(customer.enableAutoShippingDocsNotification) },
      { label: "清关资料接收邮箱", value: emailListText(customer.shippingDocsEmails) || "默认使用客户主邮箱", wide: true },
      { label: "抄送邮箱", value: emailListText(customer.shippingDocsCcEmails), wide: true },
      { label: "清关邮件语言", value: customer.clearanceEmailLanguageLabel || (customer.clearanceEmailLanguage === "RU" ? "Русский" : "English") },
      { label: "自动发送资料", value: shippingDocumentTypeLabels(customer.autoSendDocumentTypes), wide: true },
      { label: "备注", value: customer.remark || "-", wide: true },
    ];
  }
  if (tab === "users") {
    const user = row as UserRow;
    return [
      { label: "姓名", value: user.name || "-" },
      { label: "邮箱", value: user.email || "-", wide: true },
      { label: "角色", value: user.role || "-" },
      { label: "邮箱验证", value: user.emailVerified === false ? "未验证" : "已验证" },
      { label: "注册时间", value: formatDateTime(user.createdAt) },
      { label: "审核状态", value: approvalStatusText(user.approvalStatus) },
      { label: "账号状态", value: userStatus(user) },
      { label: "权限模式", value: user.permissionMode === "CUSTOM" ? "自定义" : "角色默认" },
      { label: "数据范围", value: user.customPermissions?.dataScope || "-" },
      { label: "菜单权限", value: user.customPermissions?.menus?.length ? `${user.customPermissions.menus.length} 项自定义` : "-" },
      { label: "查看权限", value: user.customPermissions?.reads?.length ? `${user.customPermissions.reads.length} 项自定义` : "-" },
      { label: "操作权限", value: user.customPermissions?.writes?.length ? `${user.customPermissions.writes.length} 项自定义` : "-" },
      { label: "绑定供应商", value: isSupplierAccountRole(user.role) ? (supplierDisplayName(user) || "-") : "-", wide: isSupplierAccountRole(user.role) },
      { label: "首次改密", value: yesNo(user.mustChangePassword) },
    ];
  }
  if (tab === "apiPerformance") {
    const metric = row as ApiPerformanceRow;
    return [
      { label: "接口路径", value: metric.path || "-", wide: true },
      { label: "方法", value: metric.method || "-" },
      { label: "来源", value: apiPerformanceSourceLabel(metric.source) },
      { label: "调用次数", value: String(metric.count || 0) },
      { label: "平均耗时", value: `${Number(metric.avgDurationMs || 0)} ms` },
      { label: "P95 耗时", value: `${Number(metric.p95DurationMs || 0)} ms` },
      { label: "最慢耗时", value: `${Number(metric.maxDurationMs || 0)} ms` },
      { label: "错误次数", value: String(metric.errorCount || 0) },
      { label: "最近状态码", value: metric.lastStatusCode == null ? "-" : String(metric.lastStatusCode) },
      { label: "最近调用", value: formatDateTime(metric.lastSeenAt) },
    ];
  }
  const log = row as AuditLogRow;
  return [
    { label: "时间", value: formatDateTime(log.createdAt) },
    { label: "操作人", value: log.user?.name || "-" },
    { label: "动作", value: log.action || "-" },
    { label: "对象", value: log.entityLabel || "-", wide: true },
    { label: "IP", value: log.ipAddress || "-" },
  ];
}

export function drawerTitleFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return customer.shortName || customer.name || "客户详情";
  }
  if (tab === "users") {
    const user = row as UserRow;
    return user.name || user.email || "用户详情";
  }
  if (tab === "apiPerformance") {
    const metric = row as ApiPerformanceRow;
    return metric.path || "慢接口详情";
  }
  const log = row as AuditLogRow;
  return log.entityLabel || log.action || "操作日志";
}

export function drawerSubtitleFor(tab: SettingsTabKey, row: CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow) {
  if (tab === "customers") {
    const customer = row as CustomerRow;
    return `国家：${customer.country || "-"} · 默认币种：${customer.defaultCurrency || "-"}`;
  }
  if (tab === "users") {
    const user = row as UserRow;
    return `角色：${user.role || "-"} · 状态：${userStatus(user)}`;
  }
  if (tab === "apiPerformance") {
    const metric = row as ApiPerformanceRow;
    return `${metric.method || "-"} · ${apiPerformanceSourceLabel(metric.source)} · P95 ${Number(metric.p95DurationMs || 0)} ms`;
  }
  const log = row as AuditLogRow;
  return `时间：${formatDateTime(log.createdAt)} · 操作人：${log.user?.name || "-"}`;
}

export function valueFor(row: CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow, column: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>) {
  if (column.render) return column.render(row);
  const key = String(column.key) as keyof typeof row;
  return String(row[key] ?? "-");
}

export function placeholderFor(tab: SettingsTabKey) {
  if (tab === "customers") return "搜索客户简称 / 全称 / 国家";
  if (tab === "suppliers") return "搜索供应商 / 类型 / 联系人 / 税号";
  if (tab === "users") return "搜索姓名 / 邮箱";
  if (tab === "apiPerformance") return "搜索接口路径或后台任务";
  return "搜索操作人 / 动作 / 对象";
}

export function kebabTab(tab: SettingsTabKey) {
  if (tab === "businessEntities") return "business-entities";
  if (tab === "exchangeRates") return "exchange-rates";
  if (tab === "commissionFormula") return "commission-formula";
  if (tab === "auditLogs") return "audit-logs";
  if (tab === "apiPerformance") return "api-performance";
  return tab;
}

export function emptyPagination(pageSize: number): Pagination {
  return { page: 1, pageSize, total: 0, totalPages: 1 };
}

export function filtersForTab(filters: SettingsFilters, tab: SettingsTabKey) {
  if (tab === "customers") return filters.customers;
  if (tab === "suppliers") return filters.suppliers;
  if (tab === "users") return filters.users;
  if (tab === "apiPerformance") return filters.apiPerformance;
  return filters.auditLogs;
}

export function appendFilterParams(params: URLSearchParams, tab: SettingsTabKey, filters: SettingsFilters[keyof SettingsFilters]) {
  if ("keyword" in filters && filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  if (tab === "suppliers") {
    const supplierFilters = filters as SettingsFilters["suppliers"];
    if (supplierFilters.type) params.set("type", supplierFilters.type);
    if (supplierFilters.status) params.set("status", supplierFilters.status);
  }
  if (tab === "users") {
    const userFilters = filters as SettingsFilters["users"];
    if (userFilters.role) params.set("role", userFilters.role);
    if (userFilters.status) params.set("status", userFilters.status);
  }
  if (tab === "auditLogs") {
    const logFilters = filters as SettingsFilters["auditLogs"];
    if (logFilters.action.trim()) params.set("action", logFilters.action.trim());
  }
  if (tab === "apiPerformance") {
    const performanceFilters = filters as SettingsFilters["apiPerformance"];
    if (performanceFilters.source) params.set("source", performanceFilters.source);
    if (performanceFilters.minDurationMs.trim()) params.set("minDurationMs", performanceFilters.minDurationMs.trim());
    if (performanceFilters.windowHours) params.set("windowHours", performanceFilters.windowHours);
  }
}

export function emptyFiltersForTab(tab: SettingsTabKey) {
  if (tab === "customers") return { keyword: "" };
  if (tab === "suppliers") return { keyword: "", type: "", status: "" };
  if (tab === "users") return { keyword: "", role: "", status: "" };
  if (tab === "apiPerformance") return { keyword: "", source: "", minDurationMs: "", windowHours: "24" };
  return { keyword: "", action: "" };
}

export function resetFilters(filters: SettingsFilters, tab: SettingsTabKey): SettingsFilters {
  return {
    ...filters,
    [tab]: emptyFiltersForTab(tab),
  } as SettingsFilters;
}

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
    customsDeclarationEnabled: settings?.customsDeclarationEnabled !== false,
    invoiceTextEnabled: settings?.invoiceTextEnabled === true,
    fallbackToPdfText: settings?.fallbackToPdfText !== false,
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

export function approvalStatusText(status: unknown) {
  if (status === "APPROVED") return "已启用";
  if (status === "PENDING") return "待审核";
  if (status === "REJECTED") return "已拒绝";
  if (status === "DISABLED") return "已停用";
  return String(status || "-");
}

export function userStatus(user: UserRow) {
  if (user.emailVerified === false) return "未验证";
  if (user.approvalStatus === "APPROVED" && user.isActive !== false) return "已启用";
  if (user.approvalStatus === "PENDING") return "待审核";
  if (user.approvalStatus === "REJECTED") return "已拒绝";
  if (user.approvalStatus === "DISABLED" || user.isActive === false) return "已停用";
  return user.approvalStatus || "-";
}

export function apiPerformanceSourceLabel(source: unknown) {
  if (source === "server") return "服务端包装器";
  if (source === "client") return "前端真实请求";
  if (source === "background") return "后台任务";
  return source ? String(source) : "-";
}

export function supplierDisplayName(user: UserRow) {
  const name = user.supplierName || "";
  const type = supplierTypeLabel(user.supplierType);
  if (name && type) return `${name} / ${type}`;
  return name || type || "";
}

export function isSupplierAccountRole(role: unknown) {
  return SUPPLIER_ACCOUNT_ROLES.includes(String(role || ""));
}

export function supplierMatchesUserRole(supplier: SupplierRow | undefined, role: string) {
  if (!supplier) return false;
  if (role === "物流供应商") return LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType || "");
  if (FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(role)) return PRODUCT_SUPPLIER_TYPES.includes(supplier.supplierType || "");
  return false;
}

export function supplierOptionLabel(supplier: SupplierRow) {
  const name = supplier.supplierName || "未命名供应商";
  const type = supplierTypeLabel(supplier.supplierType);
  return type ? `${name} / ${type}` : name;
}

export function supplierTypeLabel(value: unknown) {
  const supplierType = String(value || "");
  if (PRODUCT_SUPPLIER_TYPES.includes(supplierType)) return PRODUCT_SUPPLIER_TYPE;
  if (supplierType === LOGISTICS_SUPPLIER_TYPE_CODE) return "物流供应商";
  return supplierType;
}

export function salespersonOptionLabel(user: SalespersonOption) {
  return user.role ? `${user.name || "未命名用户"} / ${user.role}` : (user.name || "未命名用户");
}

export function fuzzyIncludes(values: unknown[], keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(normalized));
}

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

export function emailListText(value?: string[] | string) {
  if (Array.isArray(value)) return value.join("\n");
  return value || "";
}

export function shippingDocumentTypeLabels(value?: string[]) {
  const selected = value?.length ? value : SHIPPING_DOCUMENT_TYPE_OPTIONS.map((option) => option.value);
  return selected
    .map((item) => SHIPPING_DOCUMENT_TYPE_OPTIONS.find((option) => option.value === item)?.label || item)
    .join("、");
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
