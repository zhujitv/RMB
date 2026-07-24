import { LOGISTICS_COST_TYPE_OPTIONS, LOGISTICS_COST_TYPES, LOGISTICS_USD_COST_TYPES } from "../../../lib/platform/logistics-cost-types";

export const QUICK_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款", "银行手续费", "样品费", "国外佣金", "国外代理费", "佣金", "其他费用"];
export const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
export const COST_INVOICE_STATUSES = ["未收到", "已收到"];
export const COST_CONFIRMATION_OPTIONS = [
  { label: "未确认", value: "false" },
  { label: "已确认", value: "true" },
];
export const CURRENCIES = ["CNY", "USD", "EUR", "GBP", "HKD"];
export const FOREIGN_CURRENCY_COST_TYPES = ["国外佣金", "国外代理费", "佣金", ...LOGISTICS_USD_COST_TYPES];
export const FACTORY_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款"];
export const PRODUCT_SUPPLIER_TYPES = ["产品供应商", "工厂供应商"];
export const LOGISTICS_INVOICE_COST_TYPES = [...LOGISTICS_COST_TYPES, "国内物流费", "国内拖车费"];
export const COST_FILTER_TYPES = [...QUICK_COST_TYPES, ...LOGISTICS_COST_TYPES]
  .filter((type, index, rows) => rows.indexOf(type) === index);
export const COST_FILTER_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  LOGISTICS_COST_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);
export const DISABLE_COMPONENT_RENDER = [
  "OrderPayableSummary",
  "RmbSummaryBlock",
  "UsdSummaryBlock",
  "ExchangeSummaryBlock",
] as const;
void DISABLE_COMPONENT_RENDER;
export const FACTORY_DOCUMENT_TYPES = [
  { value: "SUPPLIER_PURCHASE_CONTRACT", label: "工厂采购合同", required: true },
  { value: "SUPPLIER_INVOICE", label: "工厂增值税发票", required: true },
];

import type { CostFilters, CostItemForm, QuickCostForm } from "./model-types";
export * from "./model-types";

export const PAGE_SIZE = 20;

export const emptyQuickCostForm: QuickCostForm = {
  orderId: "",
};
export function emptyCostItemForm(): CostItemForm {
  return {
    localId: `cost-item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    supplierId: "",
    costType: "工厂货款",
    amount: "",
    currency: "CNY",
    exchangeRate: "1",
    exchangeRateDate: "",
    exchangeRateSource: "系统",
    exchangeRateType: "人民币",
    paymentStatus: "待支付",
    paymentDate: "",
    costConfirmed: "false",
    remark: "",
  };
}

export const emptyCostFilters: CostFilters = {
  keyword: "",
  costStatus: "ACTIVE",
  costType: "",
  paymentStatus: "",
  costConfirmed: "",
  invoiceStatus: "",
  dateFrom: "",
  dateTo: "",
};
