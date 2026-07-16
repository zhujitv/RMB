import { Prisma } from "../generated/prisma/client.js";
import {
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_BILL_STATUS_NORMAL,
  LOGISTICS_BILL_STATUS_VOIDED,
  LOGISTICS_OPERATOR_ROLE,
  nonEmpty,
} from "./shared";

export const LOGISTICS_EXPENSE_BILLING_METHODS = ["按柜", "按票", "按次", "按重量", "按金额比例", "手工输入"];
export const DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD = "按柜";
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

export type UnknownRecord = Record<string, unknown>;
export type LogisticsTransportItemLike = {
  id?: string;
  containerNo?: string | null;
  containerType?: string | null;
  container_type?: string | null;
  sealNo?: string | null;
  seal_no?: string | null;
  truckPlateNo?: string | null;
  departureDate?: unknown;
  departurePlace?: string | null;
  arrivalPlace?: string | null;
  cargoName?: string | null;
  vesselVoyage?: string | null;
  vessel_voyage?: string | null;
} & UnknownRecord;
export type LogisticsInfoLike = {
  transportItems?: LogisticsTransportItemLike[];
  vesselVoyage?: string | null;
  vessel_voyage?: string | null;
  shippingInfo?: UnknownRecord | null;
  sailingSchedule?: UnknownRecord | null;
  containerShipment?: UnknownRecord | null;
  destinationPlace?: string | null;
  departurePlace?: string | null;
  departureDate?: unknown;
  truckPlateNo?: string | null;
  cargoDescription?: string | null;
} & UnknownRecord;
export type LogisticsOrderLike = {
  id?: string;
  orderNo?: string | null;
  blNo?: string | null;
  vesselVoyage?: string | null;
  vessel_voyage?: string | null;
  customer?: unknown;
  customerNameSnapshot?: string | null;
  domesticLogisticsInfos?: LogisticsInfoLike[];
  shippingInfo?: UnknownRecord | null;
  sailingSchedule?: UnknownRecord | null;
  containerShipment?: UnknownRecord | null;
  actualShipmentDate?: unknown;
  blDate?: unknown;
  expectedShipmentDate?: unknown;
} & UnknownRecord;
export type LogisticsSupplierLike = {
  id?: string;
  supplierName?: string | null;
  email?: string | null;
  supplierType?: unknown;
  allowLogisticsExpenseEntry?: unknown;
  allowedLogisticsCostTypes?: unknown;
  allowLogisticsInvoiceUpload?: unknown;
} & UnknownRecord;
export type LogisticsExpenseLike = {
  id?: string;
  billId?: string | null;
  orderId?: string;
  supplierId?: string;
  bill?: LogisticsBillLike | null;
  costId?: string | null;
  supplierNameSnapshot?: string | null;
  supplier?: LogisticsSupplierLike | null;
  costType?: string | null;
  currency?: string | null;
  exchangeRate?: unknown;
  exchangeRateDate?: unknown;
  exchangeRateSource?: string | null;
  exchangeRateType?: string | null;
  amount?: unknown;
  amountCny?: unknown;
  containerType?: string | null;
  appliedContainerCount?: unknown;
  billingMethod?: string | null;
  billingQuantity?: unknown;
  remark?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  detailInvoiceStatus?: string | null;
  paymentStatus?: string | null;
  detailPaymentStatus?: string | null;
  status?: string | null;
  voidedAt?: unknown;
  voidedBy?: unknown;
  voidedById?: string | null;
  voidReason?: string | null;
  voidRemark?: string | null;
  submittedAt?: unknown;
  reviewedBy?: unknown;
  reviewedAt?: unknown;
  reviewRemark?: string | null;
  rejectReason?: string | null;
  invoiceNotifiedAt?: unknown;
  invoiceNotificationError?: string | null;
  invoiceDocument?: unknown;
  invoiceDocumentId?: string | null;
  invoiceUploadedBy?: unknown;
  invoiceUploadedAt?: unknown;
  invoiceConfirmedBy?: unknown;
  invoiceConfirmedById?: string | null;
  invoiceConfirmedAt?: unknown;
  invoiceValidationStatus?: string | null;
  invoiceValidationMessage?: string | null;
  invoiceValidationJson?: unknown;
  invoiceOcrTaskId?: string | null;
  invoiceRecognizedNo?: string | null;
  invoiceRecognizedDate?: unknown;
  invoiceRecognizedSeller?: string | null;
  invoiceRecognizedBuyer?: string | null;
  invoiceRecognizedAmount?: unknown;
  invoiceRecognizedName?: string | null;
  invoiceManualConfirmedById?: string | null;
  invoiceManualConfirmedAt?: unknown;
  invoiceManualConfirmReason?: string | null;
  forceConfirmReason?: string | null;
  createdBy?: unknown;
  updatedBy?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  order?: LogisticsOrderLike | null;
} & UnknownRecord;
export type LogisticsBillLike = {
  id?: string;
  billKey?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  billOfLadingNo?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
  status?: string | null;
  voidedAt?: unknown;
  voidedBy?: unknown;
  voidedById?: string | null;
  voidReason?: string | null;
  voidRemark?: string | null;
  paymentDate?: unknown;
  submittedBy?: unknown;
  submittedAt?: unknown;
  reviewedBy?: unknown;
  reviewedAt?: unknown;
  reviewRemark?: string | null;
  rejectReason?: string | null;
  invoiceNotifiedAt?: unknown;
  invoiceNotificationError?: string | null;
  createdBy?: unknown;
  updatedBy?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
} & UnknownRecord;
export type LogisticsActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
export type LogisticsExpenseOrderForAccess = LogisticsOrderLike & {
  id: string;
  salespersonUserId?: string | null;
  customer?: ({ salespersonUserId?: string | null } & UnknownRecord) | null;
  logisticsSuppliers?: Array<{ supplierId?: string | null } & UnknownRecord> | null;
};
export type LogisticsSupplierForExpense = LogisticsSupplierLike & {
  id: string;
  supplierName?: string | null;
  supplierType: string;
  allowLogisticsExpenseEntry?: boolean | null;
  allowedLogisticsCostTypes?: unknown;
};
export type LogisticsExpenseForCostSync = LogisticsExpenseLike & {
  id: string;
  orderId: string;
  supplierId: string;
  costType?: string | null;
  currency?: string | null;
  exchangeRate?: Prisma.Decimal | number | string | null;
  exchangeRateDate?: Date | string | null;
  amount?: Prisma.Decimal | number | string | null;
  amountCny?: Prisma.Decimal | number | string | null;
};

export function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

export function logisticsExpenseActorRole(actor: LogisticsActor): string {
  return nonEmpty(actor?.role);
}

export function logisticsExpenseActorId(actor: LogisticsActor): string {
  return nonEmpty(actor?.id);
}

export function logisticsExpenseActorSupplierId(actor: LogisticsActor): string {
  return nonEmpty(actor?.supplierId);
}

export function logisticsExpenseExchangeActor(actor: LogisticsActor): { role?: string } | null {
  const role = logisticsExpenseActorRole(actor);
  return role ? { role } : null;
}

export function normalizeBillingMethodValue(value: unknown): string {
  const text = nonEmpty(value || DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  return LOGISTICS_EXPENSE_BILLING_METHODS.includes(text) ? text : DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD;
}

export {
  LOGISTICS_BILL_STATUS_NORMAL,
  LOGISTICS_BILL_STATUS_VOIDED,
  LOGISTICS_OPERATOR_ROLE,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
};
