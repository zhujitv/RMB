import {
  LOGISTICS_BILL_PAY_BUTTON_RULE,
  LOGISTICS_BILL_PAY_DISABLED_TOOLTIP,
} from "../../../lib/platform/logistics-bill-state-machine";
import {
  LOGISTICS_COST_TYPE_OPTIONS,
  LOGISTICS_COST_TYPES,
} from "../../../lib/platform/logistics-cost-types";

export const PAGE_SIZE = 20;
export const COST_TYPES = [...LOGISTICS_COST_TYPES];
export const COST_TYPE_OPTIONS = [...LOGISTICS_COST_TYPE_OPTIONS];
export const DEFAULT_BILLING_METHOD = "按柜";
export const CURRENCIES = ["CNY", "USD"];
export const FOREIGN_CURRENCY_ORDER = ["USD", "EUR", "HKD", "GBP"];
export const LOGISTICS_EXPENSE_BILL_SORT_PRIORITY: Record<string, number> = {
  草稿: 10,
  已驳回: 20,
  待审核: 30,
  待开票: 40,
  未通知: 40,
  已通知开票: 40,
  通知失败: 40,
  "待开票 / 通知失败": 40,
  部分未通知: 40,
  部分已通知: 40,
  部分上传发票: 50,
  部分上传: 50,
  部分已上传: 50,
  部分已确认: 50,
  已上传发票: 60,
  已上传: 60,
  已确认发票: 60,
  已确认: 60,
  已开票: 60,
  待付款: 70,
  部分待付款: 70,
  部分付款: 80,
  部分已付款: 80,
  已付款: 90,
  审核通过: 100,
};
export const LOGISTICS_FEE_SUPPLIER_TYPES = [
  "物流供应商",
  "报关供应商",
  "海运供应商",
  "港杂费用供应商",
  "LOGISTICS_SUPPLIER",
  "CUSTOMS_SUPPLIER",
  "FREIGHT_FORWARDER",
  "SHIPPING_SUPPLIER",
  "PORT_CHARGES_SUPPLIER",
];
export const AUDIT_FILTERS = [
  { label: "全部审核状态", value: "" },
  { label: "草稿", value: "草稿" },
  { label: "待审核", value: "待审核" },
  { label: "审核通过", value: "审核通过" },
  { label: "已驳回", value: "已驳回" },
  { label: "待开票", value: "toInvoice" },
  { label: "已上传发票", value: "uploaded" },
  { label: "已确认发票", value: "confirmedInvoice" },
];
export const BILL_STATUS_FILTERS = [
  { label: "正常账单", value: "normal" },
  { label: "已作废账单", value: "voided" },
  { label: "全部账单", value: "all" },
];
export const PAYMENT_STATUSES = ["待开票", "已开票", "待付款", "已付款"];
export const PAY_BUTTON_RULE = LOGISTICS_BILL_PAY_BUTTON_RULE;
export const PAY_BUTTON_DISABLED_TOOLTIP = LOGISTICS_BILL_PAY_DISABLED_TOOLTIP;
export const todayInputInChinaClient = () =>
  new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

import type { ExpenseForm, ExpenseItemForm } from "./model-core-types";
export * from "./model-core-types";
export * from "./model-workflow-types";

export const emptyExpenseItem = (): ExpenseItemForm => ({
  costType: "拖车费",
  billingMethod: "按柜",
  amount: "",
  appliedContainerCount: "1",
  currency: "CNY",
  currencyTouched: false,
  exchangeRate: "1",
  remark: "",
});

export const emptyExpenseForm: ExpenseForm = {
  orderId: "",
  supplierId: "",
  items: [emptyExpenseItem()],
};
