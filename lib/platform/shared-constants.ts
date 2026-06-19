// @ts-nocheck
import { logServerError, nonEmpty } from "./shared-base-utils";

export const LOGISTICS_OPERATOR_ROLE = "物流供应商";
export const LEGACY_LOGISTICS_OPERATOR_ROLE = "物流资料录入员";
export const ROLES = ["管理员", "业务员", "财务", LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE];
export const USER_APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "DISABLED"];
export const CURRENCIES = ["USD", "EUR", "GBP", "CNY", "HKD"];
export const ORDER_STATUSES = ["草稿", "已确认", "生产中", "已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"];
export const PAYMENT_STATUSES = ["待确认", "已到账", "已退回", "已取消"];
export const PAYMENT_TYPES = ["预付款", "尾款", "补差款", "其他"];
export const LEGACY_COST_TYPE_LABELS = {
  国内物流费: "拖车费",
  国内拖车费: "拖车费",
  文件费: "港杂费",
  订舱费: "港杂费",
};
export const NON_PARTICIPATING_COST_TYPES = ["目的港费用"];
export const LOGISTICS_COST_TYPES = ["拖车费", "报关费", "港杂费", "海运费", "保险费", "查验费", "超重费", "提箱费", "进港费", "其他物流费用"];
export const LOGISTICS_EXPENSE_AUDIT_STATUSES = ["草稿", "待审核", "审核通过", "已驳回"];
export const LOGISTICS_EXPENSE_INVOICE_STATUSES = ["未通知", "已通知开票", "已上传", "已确认"];
export const LOGISTICS_EXPENSE_PAYMENT_STATUSES = ["待开票", "已开票", "待付款", "已付款"];
export const TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS = [
  { key: "CUSTOMS", label: "报关费资料", missingCostLabel: "未录入报关费", costTypes: ["报关费"] },
  { key: "TRUCKING", label: "拖车费资料", missingCostLabel: "未录入拖车费", costTypes: ["拖车费", "国内物流费", "国内拖车费"] },
  { key: "PORT", label: "港杂费资料", missingCostLabel: "未录入港杂费", costTypes: ["港杂费"] },
  { key: "SEA", label: "海运费资料", missingCostLabel: "缺少海运费资料", costTypes: ["海运费"] },
];
export const SEA_FREIGHT_REQUIREMENT_KEY = "SEA";
export const SEA_FREIGHT_REQUIRED_TRADE_TERMS = ["CIF", "CFR"];
export const TAX_REFUND_LOGISTICS_RULE_VERSION = "TRADE_TERM_SEA_20260607";
export const TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES = TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.flatMap((item) => item.costTypes);
export const TAX_REFUND_LOGISTICS_INVOICE_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商"];
export const DOMESTIC_LOGISTICS_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商"];
export const DOMESTIC_LOGISTICS_TRANSPORT_TYPES = ["TRUCK", "EXPRESS", "MULTIMODAL"];
export const DOMESTIC_LOGISTICS_TRANSPORT_LABELS = {
  TRUCK: "车辆运输",
  EXPRESS: "快递运输",
  MULTIMODAL: "多式联运",
};
export const COMMISSION_LOGISTICS_COST_TYPES = ["国内物流费", "国内拖车费", ...LOGISTICS_COST_TYPES]
  .filter((item, index, arr) => arr.indexOf(item) === index);
export const FACTORY_SUPPLIER_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款"];
export const CNY_ONLY_COST_TYPES = [...FACTORY_SUPPLIER_COST_TYPES, "拖车费", "报关费", "港杂费", "查验费", "超重费", "提箱费", "进港费", "银行手续费", "样品费", "其他费用"];
export const FOREIGN_CURRENCY_COST_TYPES = ["海运费", "国外佣金", "国外代理费", "其他物流费用"];
export const LEGACY_FOREIGN_CURRENCY_COST_TYPES = ["佣金"];
export const COST_TYPES = [...CNY_ONLY_COST_TYPES, ...FOREIGN_CURRENCY_COST_TYPES, "保险费", ...LEGACY_FOREIGN_CURRENCY_COST_TYPES]
  .filter((item, index, arr) => arr.indexOf(item) === index);
export const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
export const INVOICE_STATUSES = ["未收到", "已收到"];
export const TRADE_TERMS = ["EXW", "FOB", "CFR", "CIF", "DDP", "DAP", "其他"];
export const COST_IDEMPOTENCY_WINDOW_MS = 10 * 1000;
export const COST_DUPLICATE_GUARD_LOOKBACK_MS = 60 * 1000;
export const PAYMENT_TERM_LABELS = {
  COPY_BL: "见提单复印件付款",
  OA: "OA账期",
  AFTER_ARRIVAL: "到港后付款",
  INSTALLMENT: "分批付款",
};

export function costTypeAllowsForeignCurrency(costType) {
  return FOREIGN_CURRENCY_COST_TYPES.includes(costType)
    || LEGACY_FOREIGN_CURRENCY_COST_TYPES.includes(costType);
}

export function normalizeCustomerName(value = "") {
  return String(value || "").trim().toUpperCase();
}

export function normalizedCostType(costType = "") {
  return LEGACY_COST_TYPE_LABELS[costType] || costType || "";
}

export function equivalentCostTypes(costType = "") {
  if (costType === "拖车费") return ["拖车费", "国内物流费", "国内拖车费"];
  if (costType === "港杂费") return ["港杂费", "文件费", "订舱费"];
  return [costType];
}

export function isLogisticsCostType(costType = "") {
  return LOGISTICS_COST_TYPES.includes(normalizedCostType(costType));
}

export async function runNonCriticalTask(label, task) {
  try {
    return await task();
  } catch (error) {
    logServerError(`${label}失败`, error);
    return null;
  }
}
export const PAYMENT_TERM_TYPES = Object.keys(PAYMENT_TERM_LABELS);
export const PAYMENT_TERMS = Object.values(PAYMENT_TERM_LABELS);
export const SUPPLIER_TYPES = ["工厂供应商", "物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", "其他供应商"];
export const SUPPLIER_STATUSES = ["启用", "停用"];
export const EXCHANGE_RATE_SOURCES = ["中国银行", "中国外汇交易中心", "国家外汇管理局", "第三方API"];
export const EXCHANGE_RATE_TYPES = ["现汇买入价", "现汇卖出价", "中间价"];
export const ORDER_DOCUMENT_LABELS = {
  CUSTOMS_ENTRY_FORM: "报关单",
  RELEASE_NOTICE: "放行通知书",
  CUSTOMS_POWER_OF_ATTORNEY: "报关委托书",
  BILL_OF_LADING: "提单",
  COMMERCIAL_INVOICE: "商业发票",
  PACKING_LIST: "装箱单",
  SALES_CONTRACT: "销售合同",
  EXPORT_INVOICE: "出口发票",
  SUPPLIER_PURCHASE_CONTRACT: "工厂采购合同",
  SUPPLIER_INVOICE: "工厂增值税发票",
};
export const ORDER_DOCUMENT_ENGLISH_LABELS = {
  CUSTOMS_ENTRY_FORM: "Customs-Declaration",
  RELEASE_NOTICE: "Customs-Release-Notice",
  CUSTOMS_POWER_OF_ATTORNEY: "Customs-Authorization",
  BILL_OF_LADING: "Bill-of-Lading",
  COMMERCIAL_INVOICE: "Commercial-Invoice",
  PACKING_LIST: "Packing-List",
  SALES_CONTRACT: "Sales-Contract",
  EXPORT_INVOICE: "Export-Invoice",
  SUPPLIER_PURCHASE_CONTRACT: "Factory-Contract",
  SUPPLIER_INVOICE: "Factory-Invoice",
};
export const LOGISTICS_INVOICE_ENGLISH_LABELS = {
  报关费: "Customs-Service-Invoice",
  拖车费: "Trucking-Invoice",
  港杂费: "Port-Charges-Invoice",
};
export const EXPORT_DOCUMENT_TYPES = ["CUSTOMS_ENTRY_FORM", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY", "BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST", "EXPORT_INVOICE"];
export const SALES_DOCUMENT_TYPES = ["SALES_CONTRACT"];
export const DOMESTIC_LOGISTICS_DOCUMENT_TYPES = ["CUSTOMS_ENTRY_FORM", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY"];
export const TAX_EXPORT_DOCUMENT_TYPES = [
  ...EXPORT_DOCUMENT_TYPES.filter((type) => !DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(type)),
  ...SALES_DOCUMENT_TYPES,
];
export const SUPPLIER_DOCUMENT_TYPES = ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"];
export const ORDER_DOCUMENT_TYPES = [...EXPORT_DOCUMENT_TYPES, ...SALES_DOCUMENT_TYPES, ...SUPPLIER_DOCUMENT_TYPES];
export const CUSTOMS_DECLARATION_DOCUMENT_TYPE_ALIASES = new Set(["CUSTOMS_ENTRY_FORM", "CUSTOMS_DECLARATION", "报关单"]);
export const TAX_REFUND_SUPPLIER_TYPES = ["工厂供应商"];
export const UPLOAD_STATUSES = ["PENDING", "UPLOADING", "SUCCESS", "FAILED"];
export const TAX_REFUND_STATUS_LABELS = {
  NOT_READY: "资料不完整",
  READY: "资料完整待提交",
  SUBMITTED: "已提交退税",
  PROBLEM: "资料异常",
};
export const TAX_REFUND_STATUSES = Object.keys(TAX_REFUND_STATUS_LABELS);
export const CUSTOMS_PARSE_STATUSES = ["SUCCESS", "PARTIAL", "FAILED", "MANUAL"];
export const CUSTOMS_PARSE_STATUS_LABELS = {
  SUCCESS: "成功",
  PARTIAL: "部分识别",
  FAILED: "失败",
  MANUAL: "人工修改",
};
export const CUSTOMS_PARSE_SOURCE_LABELS = {
  AUTO_PDF_TEXT: "PDF文本自动识别",
  MANUAL: "手工填写",
};
export const ACTIVE_TAX_REFUND_STATUSES = ["NOT_READY", "READY", "PROBLEM"];
export const ARCHIVE_TAX_REFUND_STATUSES = ["SUBMITTED", "COMPLETED", "ARCHIVED"];
export const CUSTOMS_FILE_READ_FAILED_MESSAGE = "报关单文件读取失败，请重新上传或联系管理员。";
export const SHIPPING_DOCUMENT_TYPE_KEYS = ["commercialInvoice", "packingList", "customsDeclaration"];
export const DEFAULT_SHIPPING_DOCUMENT_TYPES = [...SHIPPING_DOCUMENT_TYPE_KEYS];
export const SHIPPING_DOCUMENT_TYPE_CONFIG = {
  commercialInvoice: { documentType: "COMMERCIAL_INVOICE", label: "商业发票", emailLabel: "Commercial Invoice" },
  packingList: { documentType: "PACKING_LIST", label: "装箱单", emailLabel: "Packing List" },
  customsDeclaration: { documentType: "CUSTOMS_ENTRY_FORM", label: "报关单", emailLabel: "Customs Declaration" },
};
export const SHIPPING_NOTIFICATION_STATUS_LABELS = {
  NOT_ENABLED: "未启用",
  WAITING_DOCUMENTS: "等待资料完整",
  AUTO_SENT: "已自动发送",
  FAILED: "发送失败",
  MANUAL_SENT: "已手动发送",
};
export const SHIPPING_EMAIL_LANGUAGE_LABELS = {
  EN: "English",
  RU: "Русский",
  en: "English",
  ru: "Русский",
};

export function defaultClearanceEmailLanguage(country = "") {
  return /俄罗斯|russia|рф/i.test(String(country || "")) ? "RU" : "EN";
}

export function normalizeClearanceEmailLanguage(value = "", country = "") {
  const normalized = String(value || "").trim().toUpperCase();
  if (["EN", "RU"].includes(normalized)) return normalized;
  return defaultClearanceEmailLanguage(country);
}

export function normalizeOrderDocumentType(documentType = "") {
  const value = String(documentType || "").trim();
  return CUSTOMS_DECLARATION_DOCUMENT_TYPE_ALIASES.has(value) ? "CUSTOMS_ENTRY_FORM" : value;
}

export function isCustomsDeclarationDocumentType(documentType = "") {
  return normalizeOrderDocumentType(documentType) === "CUSTOMS_ENTRY_FORM";
}

export function sanitizeFilenamePart(value = "", fallback = "Document") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\\/\s]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/[._-]+$/g, "")
    .replace(/^[._-]+/g, "");
  return cleaned || fallback;
}

export function baseOrderDocumentNo(order = {}) {
  return sanitizeFilenamePart(order.blNo || order.billOfLadingNo || order.orderNo || order.id || "Order", "Order");
}

export function englishDocumentTypeLabel(documentType = "", context = {}) {
  const normalizedType = normalizeOrderDocumentType(documentType);
  if (normalizedType === "SUPPLIER_INVOICE") {
    const costType = normalizedCostType(context.cost?.costType || context.costType || "");
    if (LOGISTICS_INVOICE_ENGLISH_LABELS[costType]) return LOGISTICS_INVOICE_ENGLISH_LABELS[costType];
    if (context.relatedModule === "SUPPLIER" || context.supplierId || context.costId) return "Factory-Invoice";
  }
  return ORDER_DOCUMENT_ENGLISH_LABELS[normalizedType] || "Other-Document";
}

export function generateStandardFilename(order = {}, documentType = "", index = 1, context = {}) {
  const baseNo = baseOrderDocumentNo(order);
  const englishType = sanitizeFilenamePart(englishDocumentTypeLabel(documentType, context), "Other-Document");
  const suffix = Number(index || 1) > 1 ? `-${Number(index)}` : "";
  return `${baseNo}_${englishType}${suffix}.pdf`;
}

export function documentStandardTypeKey(document = {}) {
  return englishDocumentTypeLabel(document.documentType, {
    relatedModule: document.relatedModule,
    supplierId: document.supplierId,
    costId: document.costId,
    costType: document.cost?.costType,
    cost: document.cost,
  });
}

export function orderDocumentsForStandardNaming(order = {}) {
  return (order.documents || [])
    .filter((document) => !document.deletedAt)
    .slice()
    .sort((left, right) => {
      const typeCompare = String(documentStandardTypeKey(left)).localeCompare(String(documentStandardTypeKey(right)));
      if (typeCompare !== 0) return typeCompare;
      return new Date(left.createdAt || 0) - new Date(right.createdAt || 0);
    });
}

export function standardFilenameIndexForDocument(order = {}, document = {}) {
  const list = orderDocumentsForStandardNaming(order);
  const sameType = list.filter((item) => documentStandardTypeKey(item) === documentStandardTypeKey(document));
  const index = sameType.findIndex((item) => item.id === document.id);
  return index >= 0 ? index + 1 : sameType.length + 1;
}

export function standardFilenameForDocument(document = {}, orderOverride = null) {
  const order = orderOverride || document.order || {};
  return generateStandardFilename(order, document.documentType, standardFilenameIndexForDocument(order, document), {
    relatedModule: document.relatedModule,
    supplierId: document.supplierId,
    costId: document.costId,
    costType: document.cost?.costType,
    cost: document.cost,
  });
}

export async function nextStandardFilenameForUpload(order = {}, documentType = "", context = {}) {
  const existing = orderDocumentsForStandardNaming(order);
  const probe = {
    id: `__new__${Date.now()}`,
    documentType,
    relatedModule: context.relatedModule,
    supplierId: context.supplierId,
    costId: context.costId,
    cost: context.cost || (context.costType ? { costType: context.costType } : null),
    createdAt: new Date(),
  };
  const sameTypeCount = existing.filter((item) => documentStandardTypeKey(item) === documentStandardTypeKey(probe)).length;
  return generateStandardFilename(order, documentType, sameTypeCount + 1, context);
}

export async function resolveStandardFilenameForPersistedDocument(document = {}) {
  if (!document) return "";
  const order = document.order || {};
  return standardFilenameForDocument(document, {
    ...order,
    documents: order.documents || (document.id ? [document] : []),
  });
}

export function normalizeUploadSource(uploadSource = "", relatedModule = "") {
  const value = String(uploadSource || "").trim().toUpperCase();
  if (["SCAN", "EMAIL", "MANUAL", "API"].includes(value)) return value;
  return relatedModule === "SUPPLIER" ? "MANUAL" : "SCAN";
}

export function normalizeShippingDocumentTypes(value) {
  const rows = Array.isArray(value) ? value : String(value || "").split(/[,\n;；，]+/);
  return rows.map((item) => String(item || "").trim()).filter((item, index, arr) => SHIPPING_DOCUMENT_TYPE_KEYS.includes(item) && arr.indexOf(item) === index);
}

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
export const MAX_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;

export const EXCHANGE_RATE_SETTING_KEY = "exchange_rate";
export const DEFAULT_EXCHANGE_RATE_SETTINGS = {
  source: "中国银行",
  rateType: "中间价",
  autoUpdate: true,
  allowManualEdit: true,
  allowAdminIncompleteTaxSubmit: false,
  allowMultipleOrderLogisticsSuppliers: false,
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
export const AUTO_RATE_CURRENCIES = ["USD", "EUR", "GBP", "HKD"];
export const BOC_CURRENCY_NAMES = {
  USD: "美元",
  EUR: "欧元",
  GBP: "英镑",
  HKD: "港币",
};

export const SESSION_COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-fta_session" : "fta_session";
export const LEGACY_SESSION_COOKIE_NAME = "fta_user_id";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
export const SESSION_TOKEN_BYTES = 32;
export const PASSWORD_MIN_LENGTH = 8;
export const BCRYPT_COST = Math.min(14, Math.max(10, Number(process.env.BCRYPT_COST || 12)));
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX_FAILURES = 8;
export const SCRYPT_HASH_PREFIX = "scrypt";
export const PASSWORD_SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64,
};

export const INITIAL_ADMIN_EMAIL = nonEmpty(process.env.INITIAL_ADMIN_EMAIL);
export const INITIAL_ADMIN_PASSWORD = nonEmpty(process.env.INITIAL_ADMIN_PASSWORD);
export const UNSAFE_INITIAL_ADMIN_EMAILS = ["admin@example.com"];
export const UNSAFE_INITIAL_ADMIN_PASSWORDS = ["12345678", "admin123456", "password"];

export {
  WRITE_PERMISSIONS,
  ROLE_MENUS,
  ROLE_SCOPE_TEXT,
  READ_PERMISSIONS,
  CUSTOMER_VIEW_ALL_ROLES,
  PERMISSION_MODES,
  DATA_SCOPES,
  MENU_KEYS,
  READ_PERMISSION_KEYS,
  WRITE_PERMISSION_KEYS,
  UNSAFE_METHODS,
  SETTINGS_PERMISSION_LABELS,
} from "./shared-permission-data";
