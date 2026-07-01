import type { InputSchema } from "./shared-base-utils";
import {
  COST_PAYMENT_STATUSES,
  CURRENCIES,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
} from "./shared-constants";

function hasAny(input: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => input[key] !== undefined && input[key] !== null && String(input[key]).trim() !== "");
}

export const RECEIVABLE_ORDER_INPUT_SCHEMA: InputSchema = {
  customerId: { label: "客户", kind: "text", required: true },
  businessEntityId: { label: "业务主体", kind: "text" },
  orderNo: { label: "订单号", kind: "text", required: true },
  estimatedReceivableAmount: {
    label: "预计应收金额",
    kind: "positiveNumber",
    required: (input) => !hasAny(input, ["receivableAmount"]),
  },
  receivableAmount: {
    label: "应收金额",
    kind: "positiveNumber",
    required: (input) => !hasAny(input, ["estimatedReceivableAmount"]),
  },
  actualShipmentAmount: { label: "实际发货金额", kind: "positiveNumber" },
  actualShipmentDate: { label: "发货时间", kind: "date" },
  finalReceivableAmount: { label: "最终应收金额", kind: "positiveNumber" },
  currency: { label: "币种", kind: "enum", enumValues: CURRENCIES, required: true },
  expectedArrivalDate: { label: "预计到港日期", kind: "date" },
  expectedPaymentDate: { label: "预计付款日期", kind: "date" },
  blDate: { label: "提单日期", kind: "date" },
  dueDate: { label: "到期日", kind: "date" },
  creditDays: { label: "账期天数", kind: "nonNegativeNumber" },
};

export const PAYMENT_INPUT_SCHEMA: InputSchema = {
  orderId: { label: "关联订单", kind: "text", required: true },
  amount: { label: "收款金额", kind: "positiveNumber", required: true },
  currency: { label: "币种", kind: "enum", enumValues: CURRENCIES },
  paymentDate: { label: "收款日期", kind: "date" },
  status: { label: "收款状态", kind: "enum", enumValues: PAYMENT_STATUSES },
  paymentType: { label: "收款类型", kind: "enum", enumValues: PAYMENT_TYPES },
};

export const COST_INPUT_SCHEMA: InputSchema = {
  orderId: {
    label: "关联订单",
    kind: "text",
    required: (input) => !hasAny(input, ["receivableOrderId", "order_id"]),
  },
  receivableOrderId: {
    label: "关联订单",
    kind: "text",
    required: (input) => !hasAny(input, ["orderId", "order_id"]),
  },
  order_id: {
    label: "关联订单",
    kind: "text",
    required: (input) => !hasAny(input, ["orderId", "receivableOrderId"]),
  },
  supplierId: {
    label: "供应商",
    kind: "text",
    required: (input) => !hasAny(input, ["supplier_id"]),
  },
  supplier_id: {
    label: "供应商",
    kind: "text",
    required: (input) => !hasAny(input, ["supplierId"]),
  },
  amount: { label: "成本金额", kind: "positiveNumber", required: true },
  currency: { label: "币种", kind: "enum", enumValues: CURRENCIES },
  exchangeRate: { label: "汇率", kind: "positiveNumber" },
  paymentDate: { label: "付款日期", kind: "date" },
  paymentStatus: { label: "付款状态", kind: "enum", enumValues: COST_PAYMENT_STATUSES },
};

export const COST_BATCH_INPUT_SCHEMA: InputSchema = {
  orderId: {
    label: "关联订单",
    kind: "text",
    required: (input) => !hasAny(input, ["receivableOrderId", "order_id"]),
  },
  receivableOrderId: {
    label: "关联订单",
    kind: "text",
    required: (input) => !hasAny(input, ["orderId", "order_id"]),
  },
  order_id: {
    label: "关联订单",
    kind: "text",
    required: (input) => !hasAny(input, ["orderId", "receivableOrderId"]),
  },
  items: { label: "成本明细", kind: "array", required: true },
};

export const ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA: InputSchema = {
  orderId: { label: "订单", kind: "text", required: true },
  documentType: { label: "单证类型", kind: "text", required: true },
  costId: { label: "成本记录", kind: "text" },
  supplierId: { label: "供应商", kind: "text" },
  uploadSource: { label: "上传来源", kind: "text" },
};
