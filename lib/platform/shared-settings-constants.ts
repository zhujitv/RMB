export const CUSTOMER_COMMISSION_STATUSES = ["启用", "停用"];
export const COMMISSION_STATUSES = [
  "未结算",
  "可结算",
  "不可结算：提成比例未设置",
  "不可结算：未分配真实业务员",
  "不可结算：订单未收齐",
  "不可结算：物流费用未完整",
  "不可结算：成本未全部确认",
  "不可结算：物流成本未确认",
  "不可结算：提成金额为0",
  "已结算",
];
export const MAX_PDF_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PAYMENT_VOUCHER_UPLOAD_BYTES = 10 * 1024 * 1024;

export const EXCHANGE_RATE_SETTING_KEY = "exchange_rate";
export const PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE = "2026-06-30";
export const DEFAULT_EXCHANGE_RATE_SETTINGS = {
  source: "中国银行",
  rateType: "中间价",
  autoUpdate: true,
  allowManualEdit: true,
  allowAdminIncompleteTaxSubmit: false,
  allowMultipleOrderLogisticsSuppliers: false,
  paymentVoucherReminderStartDate: PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE,
};
export const COMPANY_PROFILE_SETTING_KEY = "company_profile";
export const DEFAULT_COMPANY_PROFILE_SETTINGS = {
  brandName: "NEXTWOOD",
  systemName: "NEXTWOOD 供应链协同平台",
  companyNameZh: "浙江莱诺建材有限公司",
  companyNameEn: "Zhejiang Lainuo Building Materials Co., Ltd.",
  shortName: "NEXTWOOD",
  website: "https://www.nextwood.net",
  contactEmail: "",
  contactPhone: "",
  address: "",
  logoUrl: "",
  footerText: "© 2026 Zhejiang Lainuo Building Materials Co., Ltd.",
};
export const OCR_INTEGRATION_SETTING_KEY = "ocr_integration";
export const LOGISTICS_INVOICE_VALIDATION_RULES_SETTING_KEY = "logistics_invoice_validation_rules";
export const DEFAULT_OCR_INTEGRATION_SETTINGS = {
  enabled: false,
  provider: "ALIYUN",
  apiBaseUrl: "https://ocr-api.cn-hangzhou.aliyuncs.com",
  accessKeyId: "",
  accessKeySecret: "",
  appCode: "",
  customsDeclarationMode: "AUTO",
  customsDeclarationEnabled: true,
  invoiceTextEnabled: false,
  supplierDocumentReturnEnabled: false,
  logisticsInvoiceEnabled: false,
  fallbackToPdfText: true,
  timeoutMs: 15000,
};
export const DEFAULT_LOGISTICS_INVOICE_VALIDATION_RULES = {
  CUSTOMS: {
    label: "报关费",
    keywords: ["报关费", "代理报关费", "报关代理服务费"],
  },
  PORT_CHARGES: {
    label: "港杂费",
    keywords: ["代理港杂费", "港杂费", "港口杂费"],
  },
  OCEAN_FREIGHT: {
    label: "海运费",
    keywords: ["国际货物运输代理服务费", "国际货运代理服务费", "海运费", "海运代理费"],
  },
  TRUCKING_OTHER: {
    label: "拖车及其他费用合并发票",
    keywords: ["国内道路运输服务代理", "道路运输服务", "拖车费", "国内运输代理服务"],
  },
};
export const SHIPSGO_INTEGRATION_SETTING_KEY = "shipsgo_integration";
export const DEFAULT_SHIPSGO_INTEGRATION_SETTINGS = {
  enabled: false,
  apiBaseUrl: "https://api.shipsgo.com",
  apiKey: "",
  oceanTrackingEnabled: true,
  airTrackingEnabled: false,
  manualSyncEnabled: true,
  autoSyncEnabled: false,
  dailySyncTime: "02:00",
  webhookEnabled: false,
  webhookSecret: "",
  liveMapEnabled: false,
  customerPushEnabled: false,
  creditWarningThreshold: 20,
};
export const COMMISSION_FORMULA_SETTING_KEY = "commission_formula";
export const COMMISSION_FORMULA_SOURCES = ["ARRIVED_PAYMENTS_CNY", "FOB_CNY", "EXPECTED_GROSS_PROFIT_CNY", "REALIZED_GROSS_PROFIT_CNY"];
export const COMMISSION_FORMULA_DEDUCTIONS = ["LOGISTICS_COST_CNY", "TOTAL_COST_CNY", "CONFIRMED_TOTAL_COST_CNY", "PAID_CONFIRMED_COST_CNY"];
export const COMMISSION_FORMULA_PRESETS = {
  ACTUAL_RECEIVED_MINUS_LOGISTICS: {
    mode: "ACTUAL_RECEIVED_MINUS_LOGISTICS",
    label: "实际到账 - 物流成本",
    source: "ARRIVED_PAYMENTS_CNY",
    deductions: ["LOGISTICS_COST_CNY"],
    floorAtZero: true,
  },
  ACTUAL_PROFIT: {
    mode: "ACTUAL_PROFIT",
    label: "实际利润",
    source: "REALIZED_GROSS_PROFIT_CNY",
    deductions: [],
    floorAtZero: true,
  },
  FOB_TOTAL: {
    mode: "FOB_TOTAL",
    label: "FOB总额",
    source: "FOB_CNY",
    deductions: [],
    floorAtZero: true,
  },
  FOB_MINUS_LOGISTICS: {
    mode: "FOB_MINUS_LOGISTICS",
    label: "FOB - 物流成本",
    source: "FOB_CNY",
    deductions: ["LOGISTICS_COST_CNY"],
    floorAtZero: true,
  },
  CUSTOM: {
    mode: "CUSTOM",
    label: "自定义公式",
    source: "ARRIVED_PAYMENTS_CNY",
    deductions: ["LOGISTICS_COST_CNY"],
    floorAtZero: true,
  },
};
export const DEFAULT_COMMISSION_FORMULA_SETTINGS = COMMISSION_FORMULA_PRESETS.ACTUAL_RECEIVED_MINUS_LOGISTICS;
export const LOGISTICS_INVOICE_NOTIFICATION_SETTING_KEY = "logistics_invoice_notification_template";
export const LOGISTICS_INVOICE_NOTIFICATION_VARIABLES = [
  "supplierName",
  "billCount",
  "orderNo",
  "blNo",
  "customerShortName",
  "containerSummary",
  "amountCny",
  "expenseDetails",
  "invoiceGroups",
  "remark",
  "billRows",
  "invoiceRequirements",
  "uploadUrl",
  "signature",
];
export const LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS = [
  { value: "operatorUsers.email", label: "绑定登录账号邮箱", field: "supplier.operatorUsers.email" },
  { value: "contactEmail", label: "供应商联系邮箱", field: "supplier.contactEmail" },
  { value: "email", label: "供应商主邮箱", field: "supplier.email" },
  { value: "financeEmail", label: "供应商财务邮箱", field: "supplier.financeEmail" },
];
export const DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS = LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELD_OPTIONS.map((item) => item.value);
export const DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS = {
  autoSendOnApproval: true,
  recipientEmailFields: DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
  ccAdminEmails: true,
  ccEmails: [],
  singleSubjectTemplate: "物流费用已审核通过，请开票并上传发票 - {orderNo}/{blNo}",
  batchSubjectTemplate: "待开票物流费用清单（{billCount} 票）",
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
};
export const AUTO_RATE_CURRENCIES = ["USD", "EUR", "GBP", "HKD"];
export const BOC_CURRENCY_NAMES = {
  USD: "美元",
  EUR: "欧元",
  GBP: "英镑",
  HKD: "港币",
};
