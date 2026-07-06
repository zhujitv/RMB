import type { NotificationTemplateForm, OcrIntegrationForm, SettingsTabKey, ShipsgoIntegrationForm } from "./types";

export const PAGE_SIZE = 20;
export const AUDIT_PAGE_SIZE = 50;
export const API_PERFORMANCE_PAGE_SIZE = 20;
export const CURRENCIES = ["", "CNY", "USD", "EUR", "GBP", "HKD"];
export const SHIPPING_DOCUMENT_TYPE_OPTIONS = [
  { key: "invoice", value: "commercialInvoice", label: "商业发票" },
  { key: "packingList", value: "packingList", label: "装箱单" },
  { key: "customsDeclaration", value: "customsDeclaration", label: "报关单" },
] as const;
export type ShippingDocumentConfigKey = typeof SHIPPING_DOCUMENT_TYPE_OPTIONS[number]["key"];
export type ShippingDocumentConfig = Record<ShippingDocumentConfigKey, boolean>;
export const CUSTOMER_COMMISSION_STATUSES = ["启用", "停用"];
export const PRODUCT_SUPPLIER_TYPE = "产品供应商";
export const LEGACY_FACTORY_SUPPLIER_TYPE = "工厂供应商";
export const PRODUCT_SUPPLIER_TYPE_CODE = "PRODUCT";
export const LOGISTICS_SUPPLIER_TYPE_CODE = "LOGISTICS";
export const PRODUCT_SUPPLIER_TYPES = [PRODUCT_SUPPLIER_TYPE, LEGACY_FACTORY_SUPPLIER_TYPE, PRODUCT_SUPPLIER_TYPE_CODE];
export const SUPPLIER_TYPES = [PRODUCT_SUPPLIER_TYPE, "物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", "其他供应商"];
export const SUPPLIER_STATUSES = ["启用", "停用"];
export const LOGISTICS_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", LOGISTICS_SUPPLIER_TYPE_CODE];
export const FACTORY_SUPPLIER_ACCOUNT_ROLE = "产品供应商";
export const LEGACY_PRODUCT_SUPPLIER_ACCOUNT_ROLE = `${FACTORY_SUPPLIER_ACCOUNT_ROLE}账号`;
export const LEGACY_FACTORY_SUPPLIER_ACCOUNT_ROLE = "工厂供应商账号";
export const FACTORY_SUPPLIER_ACCOUNT_ROLES = [FACTORY_SUPPLIER_ACCOUNT_ROLE, LEGACY_PRODUCT_SUPPLIER_ACCOUNT_ROLE, LEGACY_FACTORY_SUPPLIER_ACCOUNT_ROLE];
export const SUPPLIER_ACCOUNT_ROLES = ["物流供应商", ...FACTORY_SUPPLIER_ACCOUNT_ROLES];
export const SUPPLIER_LOGISTICS_COST_TYPE_UI_META: Record<string, { label?: string; description: string }> = {
  拖车费: { description: "国内拖车、短驳、提送柜等运输费用。" },
  报关费: { description: "出口报关代理、申报服务相关费用。" },
  港杂费: { description: "码头、港区、港口服务等本地杂费。" },
  海运费: { description: "海运主运费及承运人相关费用。" },
  保险费: { description: "货运保险及运输保障费用。" },
  ENS: { label: "ENS", description: "ENS 申报及相关承运人费用。" },
  打单费: { description: "单证制作、文件处理、打单服务费用。" },
  查验费: { description: "海关查验、协查、查验服务费用。" },
  超重费: { description: "超重箱、超限或额外重量附加费。" },
  提箱费: { description: "提空箱、提重箱或场站提箱费用。" },
  进港费: { description: "集装箱进港、入场及相关操作费用。" },
  落箱费: { description: "落箱、堆存或场站临时操作费用。" },
  预提费: { description: "预提箱、提前操作及相关服务费用。" },
  其他本地费用: { description: "不属于上述类型的人民币本地物流费用。" },
  其他国际费用: { description: "不属于上述类型的美元国际物流费用。" },
  其他物流费用: { description: "不属于上述类型的零散物流费用。" },
};
export const EXCHANGE_RATE_SOURCES = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
export const EXCHANGE_RATE_TYPES = ["现汇买入价", "现汇卖出价", "中间价"];
export const COMMISSION_FORMULA_PRESETS = [
  { value: "ACTUAL_RECEIVED_MINUS_LOGISTICS", label: "实际到账 - 物流成本", source: "ARRIVED_PAYMENTS_CNY", deductions: ["LOGISTICS_COST_CNY"] },
  { value: "ACTUAL_PROFIT", label: "实际利润", source: "REALIZED_GROSS_PROFIT_CNY", deductions: [] },
  { value: "FOB_TOTAL", label: "FOB总额", source: "FOB_CNY", deductions: [] },
  { value: "FOB_MINUS_LOGISTICS", label: "FOB - 物流成本", source: "FOB_CNY", deductions: ["LOGISTICS_COST_CNY"] },
  { value: "CUSTOM", label: "自定义公式", source: "ARRIVED_PAYMENTS_CNY", deductions: ["LOGISTICS_COST_CNY"] },
];
export const COMMISSION_FORMULA_SOURCES = [
  { value: "ARRIVED_PAYMENTS_CNY", label: "实际到账货款" },
  { value: "FOB_CNY", label: "FOB总额" },
  { value: "EXPECTED_GROSS_PROFIT_CNY", label: "预计利润" },
  { value: "REALIZED_GROSS_PROFIT_CNY", label: "实际利润" },
];
export const COMMISSION_FORMULA_DEDUCTIONS = [
  { value: "LOGISTICS_COST_CNY", label: "物流成本总和", description: "从FOB中扣减物流费用" },
  { value: "TOTAL_COST_CNY", label: "总成本", description: "扣减所有成本" },
  { value: "CONFIRMED_TOTAL_COST_CNY", label: "已确认总成本", description: "只扣减已确认的成本" },
  { value: "PAID_CONFIRMED_COST_CNY", label: "已支付确认成本", description: "只扣减已支付且已确认的成本" },
];
export const NOTIFICATION_TEMPLATE_VARIABLES = [
  ["{supplierName}", "供应商名称"],
  ["{billCount}", "本次邮件包含票数"],
  ["{orderNo}", "订单号"],
  ["{blNo}", "提单号"],
  ["{customerShortName}", "客户简称"],
  ["{containerSummary}", "柜型 / 柜量"],
  ["{amountCny}", "账单合计"],
  ["{expenseDetails}", "费用明细"],
  ["{invoiceGroups}", "应上传发票分组"],
  ["{remark}", "备注"],
  ["{billRows}", "待开票费用清单"],
  ["{invoiceRequirements}", "开票要求"],
  ["{uploadUrl}", "发票上传入口"],
  ["{signature}", "邮件落款"],
] as const;
export const NOTIFICATION_RECIPIENT_EMAIL_OPTIONS = [
  {
    value: "operatorUsers.email",
    label: "绑定登录账号邮箱",
    description: "读取物流供应商绑定的系统登录账号邮箱。",
  },
  {
    value: "contactEmail",
    label: "供应商联系邮箱",
    description: "读取供应商资料中的联系邮箱。",
  },
  {
    value: "email",
    label: "供应商主邮箱",
    description: "读取供应商资料中的主邮箱。",
  },
  {
    value: "financeEmail",
    label: "供应商财务邮箱",
    description: "读取供应商资料中的财务邮箱。",
  },
] as const;
export const DEFAULT_NOTIFICATION_TEMPLATE_FORM: NotificationTemplateForm = {
  type: "LOGISTICS_INVOICE_NOTICE",
  name: "物流费用开票通知",
  module: "物流费用",
  description: "",
  enabled: true,
  editable: true,
  supportsAttachments: false,
  securitySensitive: false,
  subjectTemplate: "物流费用已审核通过，请开票并上传发票 - {orderNo}/{blNo}",
  ccAdminEmails: true,
  ccEmails: "",
  bodyTemplate: [
    "{supplierName}，您好：",
    "",
    "以下物流费用已审核通过，请按开票要求开具发票，并登录系统在对应账单中上传发票。",
    "",
    "待开票费用清单：",
    "{billRows}",
    "",
    "开票要求：",
    "{invoiceRequirements}",
    "",
    "发票上传入口：{uploadUrl}",
    "",
    "{signature}",
  ].join("\n"),
  variables: NOTIFICATION_TEMPLATE_VARIABLES.map(([key, label]) => ({ key: key.replace(/[{}]/g, ""), label })),
  recipientConfig: { recipientEmailFields: NOTIFICATION_RECIPIENT_EMAIL_OPTIONS.map((item) => item.value) },
  extraConfig: {
    autoSendOnApproval: true,
    batchSubjectTemplate: "待开票物流费用清单（{billCount} 票）",
    invoiceRequirements: [
      "1. 发票金额需与系统审核通过的费用合计一致。",
      "2. 发票抬头、税号、供应商信息需与系统资料一致。",
      "3. 报关费、港杂费必须分别开票上传。",
      "4. 海运费、ENS费、保险费及所有 USD 费用统一归入“海运费发票”上传。",
      "5. 拖车费、打单费、进港费、提箱费、落箱费、预提费、查验费、超重费和其他 CNY 物流费用可合并为“拖车及其他费用合并发票”上传。",
      "6. 发票上传后必须在对应物流费用账单中提交，系统会绑定到该账单记录。",
    ].join("\n"),
    uploadUrl: "",
    signature: "NEXTWOOD 供应链协同平台",
  },
};
export const DEFAULT_SHIPSGO_INTEGRATION_FORM: ShipsgoIntegrationForm = {
  enabled: false,
  apiBaseUrl: "https://api.shipsgo.com",
  apiKey: "",
  apiKeyConfigured: false,
  oceanTrackingEnabled: true,
  airTrackingEnabled: false,
  manualSyncEnabled: true,
  autoSyncEnabled: false,
  dailySyncTime: "02:00",
  webhookEnabled: false,
  webhookSecret: "",
  webhookSecretConfigured: false,
  liveMapEnabled: false,
  customerPushEnabled: false,
  creditWarningThreshold: "20",
};
export const DEFAULT_OCR_INTEGRATION_FORM: OcrIntegrationForm = {
  enabled: false,
  provider: "ALIYUN",
  apiBaseUrl: "https://ocr-api.cn-hangzhou.aliyuncs.com",
  accessKeyId: "",
  accessKeyIdConfigured: false,
  accessKeySecret: "",
  accessKeySecretConfigured: false,
  appCode: "",
  appCodeConfigured: false,
  invoiceTextEnabled: false,
  supplierDocumentReturnEnabled: false,
  logisticsInvoiceEnabled: false,
  timeoutMs: "15000",
};
export const OCR_FEATURE_OPTIONS = [
  {
    key: "invoiceTextEnabled",
    label: "发票结构化识别",
    description: "用于增值税发票号、购买方、销售方、金额、税率和明细识别。",
  },
  {
    key: "supplierDocumentReturnEnabled",
    label: "产品供应商资料回传 OCR",
    description: "供应商上传采购合同和增值税发票后自动识别并校验内容。",
  },
  {
    key: "logisticsInvoiceEnabled",
    label: "物流费用发票 OCR",
    description: "物流费用分组发票上传后自动识别金额和服务名称，并校验分组合计。",
  },
] satisfies Array<{
  key: keyof Pick<
    OcrIntegrationForm,
    "invoiceTextEnabled" | "supplierDocumentReturnEnabled" | "logisticsInvoiceEnabled"
  >;
  label: string;
  description: string;
}>;
export const SHIPSGO_FEATURE_OPTIONS = [
  {
    key: "oceanTrackingEnabled",
    label: "海运集装箱跟踪",
    description: "按提单号、柜号创建大掌櫃海运跟踪任务。",
  },
  {
    key: "airTrackingEnabled",
    label: "空运货物跟踪",
    description: "预留空运 AWB 跟踪能力，开启后前台显示空运入口。",
  },
  {
    key: "manualSyncEnabled",
    label: "手动同步",
    description: "允许在物流页面手动刷新大掌櫃跟踪状态。",
  },
  {
    key: "autoSyncEnabled",
    label: "每日自动同步",
    description: "按配置时间每日拉取状态更新。",
  },
  {
    key: "webhookEnabled",
    label: "Webhook 推送",
    description: "允许接收大掌櫃状态变更推送。",
  },
  {
    key: "liveMapEnabled",
    label: "地图入口",
    description: "开启后前台显示大掌柜返回的原始地图链接。",
  },
  {
    key: "customerPushEnabled",
    label: "客户自动推送",
    description: "状态更新后可扩展为邮件推送客户。",
  },
] satisfies Array<{
  key: keyof Pick<
    ShipsgoIntegrationForm,
    "oceanTrackingEnabled" | "airTrackingEnabled" | "manualSyncEnabled" | "autoSyncEnabled" | "webhookEnabled" | "liveMapEnabled" | "customerPushEnabled"
  >;
  label: string;
  description: string;
}>;
export const USER_ROLES = ["管理员", "业务员", "财务", "物流供应商", FACTORY_SUPPLIER_ACCOUNT_ROLE, "物流资料录入员"];
export const USER_APPROVAL_STATUS_OPTIONS = [
  { label: "待审核", value: "PENDING" },
  { label: "已启用", value: "APPROVED" },
  { label: "已拒绝", value: "REJECTED" },
  { label: "已停用", value: "DISABLED" },
];
export const USER_STATUS_FILTER_OPTIONS = [
  { label: "已验证", value: "email_verified" },
  { label: "未验证", value: "email_unverified" },
];
export const API_PERFORMANCE_SOURCE_OPTIONS = [
  { label: "全部来源", value: "" },
  { label: "服务端包装器", value: "server" },
  { label: "前端真实请求", value: "client" },
  { label: "后台任务", value: "background" },
];
export const API_PERFORMANCE_WINDOW_OPTIONS = [
  { label: "最近 1 小时", value: "1" },
  { label: "最近 6 小时", value: "6" },
  { label: "最近 24 小时", value: "24" },
  { label: "最近 72 小时", value: "72" },
  { label: "最近 7 天", value: "168" },
];
export const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
  { key: "home", label: "设置中心" },
  { key: "companyProfile", label: "公司资料" },
  { key: "businessEntities", label: "业务主体" },
  { key: "customers", label: "客户资料" },
  { key: "suppliers", label: "供应商资料" },
  { key: "users", label: "用户与权限" },
  { key: "ocrIntegration", label: "OCR识别" },
  { key: "shipsgoIntegration", label: "物流接口" },
  { key: "notificationTemplates", label: "通知模板" },
  { key: "exchangeRates", label: "汇率设置" },
  { key: "commissionFormula", label: "提成公式" },
  { key: "auditLogs", label: "系统日志" },
  { key: "apiPerformance", label: "后台任务" },
];
