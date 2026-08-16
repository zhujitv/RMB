import {
  LOGISTICS_COST_TYPE_ENGLISH_LABELS,
  LOGISTICS_COST_TYPES,
  LOGISTICS_INVOICE_ENGLISH_LABELS,
  LOGISTICS_USD_COST_TYPES,
} from "./logistics-cost-types";
import {
  LOGISTICS_SUPPLIER_TYPE_CODE,
  PRODUCT_SUPPLIER_TYPE,
  PRODUCT_SUPPLIER_TYPES,
} from "./shared-party-constants";
import {
  LEGACY_LOGISTICS_EXPENSE_COST_SOURCE_TYPE,
  LOGISTICS_FEE_COST_SOURCE_TYPE,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  isLogisticsGeneratedCostSourceType,
} from "./logistics-generated-cost-source-types";

export {
  LEGACY_LOGISTICS_EXPENSE_COST_SOURCE_TYPE,
  LOGISTICS_FEE_COST_SOURCE_TYPE,
  LOGISTICS_GENERATED_COST_SOURCE_TYPES,
  LOGISTICS_COST_TYPE_ENGLISH_LABELS,
  LOGISTICS_COST_TYPES,
  LOGISTICS_INVOICE_ENGLISH_LABELS,
  isLogisticsGeneratedCostSourceType,
};

export const USER_APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "DISABLED"];
export const CURRENCIES = ["USD", "EUR", "GBP", "CNY", "HKD"];
export const ORDER_STATUSES = ["草稿", "已确认", "生产中", "已发货", "部分收款", "已收齐", "多收款", "已关闭", "已取消"];
export const PAYMENT_STATUSES = ["待确认", "已到账", "已退回", "已取消"];
export const PAYMENT_TYPES = ["预付款", "中期款", "分批款", "全款", "尾款", "补差款", "退款", "其他"];
export const LEGACY_COST_TYPE_LABELS = {
  国内物流费: "拖车费",
  国内拖车费: "拖车费",
  文件费: "港杂费",
  订舱费: "港杂费",
  ENS费: "ENS",
} satisfies Record<string, string>;
export const NON_PARTICIPATING_COST_TYPES = ["目的港费用"];
export const LOGISTICS_EXPENSE_AUDIT_STATUSES = ["草稿", "待审核", "审核通过", "已驳回"];
export const LOGISTICS_EXPENSE_INVOICE_STATUSES = ["待开票", "已上传", "已确认", "未通知", "已通知开票", "通知失败"];
export const LOGISTICS_EXPENSE_PAYMENT_STATUSES = ["待开票", "已开票", "待付款", "已付款"];
export const LOGISTICS_BILL_STATUS_NORMAL = "normal";
export const LOGISTICS_BILL_STATUS_VOIDED = "voided";
export const TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS = [
  { key: "CUSTOMS", label: "报关费发票", missingCostLabel: "缺少报关费发票", costTypes: ["报关费"] },
  { key: "TRUCKING", label: "拖车费发票", missingCostLabel: "缺少拖车发票", costTypes: ["拖车费", "国内物流费", "国内拖车费", "打单费", "进港费", "提箱费", "落箱费", "预提费", "查验费", "超重费", "其他本地费用", "其他物流费用"] },
  { key: "PORT", label: "港杂费发票", missingCostLabel: "缺少港杂费发票", costTypes: ["港杂费", "文件费", "订舱费"] },
  { key: "SEA", label: "海运费发票", missingCostLabel: "缺少海运费发票", costTypes: ["海运费", "其他国际费用"] },
];
export const SEA_FREIGHT_REQUIREMENT_KEY = "SEA";
export const SEA_FREIGHT_REQUIRED_TRADE_TERMS = ["CIF", "CFR"];
export const TAX_REFUND_BASE_LOGISTICS_REQUIREMENT_KEYS = ["CUSTOMS", "TRUCKING", "PORT"];
export const TAX_REFUND_LOGISTICS_RULE_VERSION = "TRADE_TERM_LOGISTICS_INVOICES_20260709_EXW_NOT_APPLICABLE";
export const TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES = TAX_REFUND_LOGISTICS_INVOICE_REQUIREMENTS.flatMap((item) => item.costTypes);
export const TAX_REFUND_LOGISTICS_INVOICE_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商"];
export const DOMESTIC_LOGISTICS_SUPPLIER_TYPES = ["物流供应商", "报关供应商", "海运供应商", "港杂费用供应商", LOGISTICS_SUPPLIER_TYPE_CODE];
export const DOMESTIC_LOGISTICS_TRANSPORT_TYPES = ["TRUCK", "EXPRESS", "MULTIMODAL", "BULK_WAREHOUSE"];
export const DOMESTIC_LOGISTICS_TRANSPORT_LABELS = {
  TRUCK: "车辆运输",
  EXPRESS: "快递运输",
  MULTIMODAL: "多式联运",
  BULK_WAREHOUSE: "散货进舱",
};
export const COMMISSION_LOGISTICS_COST_TYPES = ["国内物流费", "国内拖车费", ...LOGISTICS_COST_TYPES]
  .filter((item, index, arr) => arr.indexOf(item) === index);
export const FACTORY_SUPPLIER_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款"];
export const CNY_ONLY_COST_TYPES = [...FACTORY_SUPPLIER_COST_TYPES, "拖车费", "报关费", "港杂费", "打单费", "进港费", "提箱费", "落箱费", "预提费", "查验费", "超重费", "其他本地费用", "银行手续费", "样品费", "其他费用"];
export const FOREIGN_CURRENCY_COST_TYPES = [...LOGISTICS_USD_COST_TYPES, "国外佣金", "国外代理费", "其他物流费用"];
export const LEGACY_FOREIGN_CURRENCY_COST_TYPES = ["佣金"];
export const COST_TYPES = [...CNY_ONLY_COST_TYPES, ...FOREIGN_CURRENCY_COST_TYPES, ...LEGACY_FOREIGN_CURRENCY_COST_TYPES]
  .filter((item, index, arr) => arr.indexOf(item) === index);
export const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
export const ORDER_COST_STATUS_ACTIVE = "ACTIVE";
export const ORDER_COST_STATUS_VOID = "VOID";
export const ORDER_COST_STATUSES = [ORDER_COST_STATUS_ACTIVE, ORDER_COST_STATUS_VOID];
export const INVOICE_STATUSES = ["未收到", "已收到"];
export const TRADE_TERMS = ["EXW", "FOB", "FCA", "CFR", "CIF", "DDP", "DAP", "其他"];
export const COST_IDEMPOTENCY_WINDOW_MS = 10 * 1000;
export const COST_DUPLICATE_GUARD_LOOKBACK_MS = 60 * 1000;
export const PAYMENT_TERM_LABELS = {
  COPY_BL: "见提单复印件付款",
  OA: "OA账期",
  AFTER_ARRIVAL: "到港后付款",
  INSTALLMENT: "分批付款",
};

export function costTypeAllowsForeignCurrency(costType: string = "") {
  return FOREIGN_CURRENCY_COST_TYPES.includes(costType)
    || LEGACY_FOREIGN_CURRENCY_COST_TYPES.includes(costType);
}

export function normalizeCustomerName(value: unknown = "") {
  return String(value || "").trim().toUpperCase();
}

export function normalizedCostType(costType: string = "") {
  return (LEGACY_COST_TYPE_LABELS as Record<string, string>)[costType] || costType || "";
}

export function equivalentCostTypes(costType: string = "") {
  if (costType === "拖车费") return ["拖车费", "国内物流费", "国内拖车费"];
  if (costType === "港杂费") return ["港杂费", "文件费", "订舱费"];
  return [costType];
}

export function isLogisticsCostType(costType: string = "") {
  return LOGISTICS_COST_TYPES.includes(normalizedCostType(costType));
}

export function normalizedCostTradeTerm(tradeTerm: unknown = "") {
  return String(tradeTerm || "").trim().toUpperCase();
}

export function isOrderCostExcludedByTradeTerm(tradeTerm: unknown, costType: unknown) {
  return normalizedCostTradeTerm(tradeTerm) === "FOB"
    && normalizedCostType(String(costType || "")) === "海运费";
}
