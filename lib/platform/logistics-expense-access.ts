import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { includeCostRelations } from "./cost-records-shared";
import {
  CURRENCIES,
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_COST_TYPES,
  LOGISTICS_EXPENSE_AUDIT_STATUSES,
  LOGISTICS_EXPENSE_INVOICE_STATUSES,
  LOGISTICS_OPERATOR_ROLE,
  amountCny,
  canRead,
  canWrite,
  codedError,
  customerBusinessName,
  customerShortName,
  dateFromInput,
  dateToInput,
  expandLegacyFullLogisticsCostTypeList,
  getExchangeRateQuote,
  nonEmpty,
  normalizedCostType,
  optional,
  permissionError,
  requirePositive,
  resolveExchangeRateSnapshot,
  serializeOrderDocument,
  serializeSupplier,
  serializeUser,
  todayInputInChina,
} from "./shared";
import { assertSupplierActive } from "./supplier-masters";
import {
  logisticsCostTypeDefaultCurrency,
  logisticsCostTypeLocksCurrency,
} from "./logistics-cost-types";
import {
  logisticsInvoiceGroupForExpense,
  logisticsInvoiceGroupsForExpenses,
} from "./logistics-invoice-groups";
import { summarizeCurrencyTotals } from "./currency-totals";

const LOGISTICS_EXPENSE_BILLING_METHODS = ["按柜", "按票", "按次", "按重量", "按金额比例", "手工输入"];
const DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD = "按柜";
const LOGISTICS_EXPENSE_BILL_SORT_PRIORITY: Record<string, number> = {
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

type UnknownRecord = Record<string, unknown>;
type LogisticsTransportItemLike = {
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
type LogisticsInfoLike = {
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
type LogisticsOrderLike = {
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
type LogisticsSupplierLike = {
  id?: string;
  supplierName?: string | null;
  email?: string | null;
  supplierType?: unknown;
  allowLogisticsExpenseEntry?: unknown;
  allowedLogisticsCostTypes?: unknown;
  allowLogisticsInvoiceUpload?: unknown;
} & UnknownRecord;
type LogisticsExpenseLike = {
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
  paymentStatus?: string | null;
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
  invoiceConfirmedAt?: unknown;
  forceConfirmReason?: string | null;
  createdBy?: unknown;
  updatedBy?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  order?: LogisticsOrderLike | null;
} & UnknownRecord;
type LogisticsBillLike = {
  id?: string;
  billKey?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  billOfLadingNo?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
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
type LogisticsActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type LogisticsExpenseOrderForAccess = LogisticsOrderLike & {
  id: string;
  customer?: ({ salespersonUserId?: string | null } & UnknownRecord) | null;
  logisticsSuppliers?: Array<{ supplierId?: string | null } & UnknownRecord> | null;
};
type LogisticsSupplierForExpense = LogisticsSupplierLike & {
  id: string;
  supplierName?: string | null;
  supplierType: string;
  allowLogisticsExpenseEntry?: boolean | null;
  allowedLogisticsCostTypes?: unknown;
};
type LogisticsExpenseForCostSync = LogisticsExpenseLike & {
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

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function actorRole(actor: LogisticsActor): string {
  return nonEmpty(actor?.role);
}

function actorId(actor: LogisticsActor): string {
  return nonEmpty(actor?.id);
}

function actorSupplierId(actor: LogisticsActor): string {
  return nonEmpty(actor?.supplierId);
}

function exchangeActor(actor: LogisticsActor): { role?: string } | null {
  const role = actorRole(actor);
  return role ? { role } : null;
}

export function includeLogisticsExpenseRelations() {
  return Prisma.validator<Prisma.LogisticsExpenseInclude>()({
    bill: {
      include: {
        submittedBy: true,
        reviewedBy: true,
        createdBy: true,
        updatedBy: true,
      },
    },
    order: {
      include: {
        customer: true,
        salesperson: true,
        logisticsSuppliers: { include: { supplier: true } },
        domesticLogisticsInfos: {
          include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
        },
      },
    },
    supplier: { include: { operatorUsers: true } },
    cost: { include: includeCostRelations() },
    createdBy: true,
    updatedBy: true,
    reviewedBy: true,
    invoiceDocument: { include: { uploadedBy: true, supplier: true, cost: true } },
    invoiceUploadedBy: true,
    invoiceConfirmedBy: true,
  });
}

export function logisticsExpenseBillOfLadingNo(order: LogisticsOrderLike = {}) {
  return nonEmpty(order.blNo || order.orderNo || "no-bl");
}

export function logisticsExpenseBillKey(orderId: unknown, billOfLadingNo: unknown) {
  const id = nonEmpty(orderId);
  const blNo = nonEmpty(billOfLadingNo || "no-bl").toLowerCase();
  return id ? `${id}::${blNo}` : "";
}

export function logisticsExpenseBillKeyForOrder(order: LogisticsOrderLike = {}) {
  return logisticsExpenseBillKey(order.id, logisticsExpenseBillOfLadingNo(order));
}

function logisticsExpenseBillRecord(expense: LogisticsExpenseLike = {}): LogisticsBillLike {
  return asRecord(expense.bill) as LogisticsBillLike;
}

function logisticsExpenseBillField(expense: LogisticsExpenseLike = {}, field: keyof LogisticsBillLike, fallback: unknown = "") {
  const bill = logisticsExpenseBillRecord(expense);
  return bill[field] ?? fallback;
}

function resolveLogisticsExpenseVesselVoyage(order: LogisticsOrderLike = {}) {
  const info = (order.domesticLogisticsInfos || [])[0] || {};
  const firstItem = (info.transportItems || [])[0] || {};
  const shippingInfo = asRecord(info.shippingInfo || order.shippingInfo);
  const sailingSchedule = asRecord(info.sailingSchedule || order.sailingSchedule);
  const containerShipment = asRecord(info.containerShipment || order.containerShipment);
  return nonEmpty(
    order.vesselVoyage ||
    order.vessel_voyage ||
    info.vesselVoyage ||
    info.vessel_voyage ||
    firstItem.vesselVoyage ||
    firstItem.vessel_voyage ||
    shippingInfo.vesselVoyage ||
    shippingInfo.vessel_voyage ||
    sailingSchedule.vesselVoyage ||
    sailingSchedule.vessel_voyage ||
    containerShipment.vesselVoyage ||
    containerShipment.vessel_voyage
  );
}

export function logisticsExpenseOrderSummary(order: LogisticsOrderLike = {}) {
  const info = (order.domesticLogisticsInfos || [])[0] || {};
  const firstItem = (info.transportItems || [])[0] || {};
	  const transportItems = (info.transportItems || []).map((item) => ({
	    id: item.id || "",
	    containerNo: item.containerNo || "",
	    containerType: item.containerType || item.container_type || "",
	    sealNo: item.sealNo || item.seal_no || "",
	    truckPlateNo: item.truckPlateNo || "",
    departureDate: dateToInput(dateFromInput(item.departureDate)),
    departurePlace: item.departurePlace || "",
    arrivalPlace: item.arrivalPlace || "",
    cargoName: item.cargoName || "",
  }));
  const containerNos = transportItems.map((item) => item.containerNo).filter(Boolean);
  const containerTypes = [...new Set(transportItems.map((item) => item.containerType).filter(Boolean))];
  return {
    orderId: order.id || "",
    orderNo: order.orderNo || "",
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerShortName: customerShortName(order.customer),
    customerName: customerBusinessName(order.customer, nonEmpty(order.customerNameSnapshot)),
    vesselVoyage: resolveLogisticsExpenseVesselVoyage(order),
    containerType: containerTypes.length === 1 ? containerTypes[0] : "",
    containerTypes,
    port: firstItem.arrivalPlace || info.destinationPlace || "",
    loadingAddress: firstItem.departurePlace || info.departurePlace || "",
    sailingDate: dateToInput(dateFromInput(firstItem.departureDate || info.departureDate || order.actualShipmentDate || order.blDate || order.expectedShipmentDate)),
    truckPlateNo: firstItem.truckPlateNo || info.truckPlateNo || "",
    cargoName: firstItem.cargoName || info.cargoDescription || "",
    transportItems,
    containerNos,
    containerCount: containerNos.length || transportItems.length || 0,
  };
}

export function serializeLogisticsExpense(expense: LogisticsExpenseLike = {}) {
  const orderSummary = logisticsExpenseOrderSummary(expense.order || {});
  const invoiceDocument = expense.invoiceDocument ? serializeOrderDocument(expense.invoiceDocument, expense.order) : null;
  const bill = logisticsExpenseBillRecord(expense);
  const auditStatus = nonEmpty(bill.auditStatus || expense.auditStatus || "草稿");
  return {
    id: expense.id,
    billId: expense.billId || bill.id || "",
    orderId: expense.orderId || "",
    orderNo: orderSummary.orderNo,
    blNo: orderSummary.blNo,
    billOfLadingNo: orderSummary.billOfLadingNo,
    customerName: orderSummary.customerName,
    customerShortName: orderSummary.customerShortName,
    supplierId: expense.supplierId || "",
    supplierName: expense.supplierNameSnapshot || expense.supplier?.supplierName || "",
    supplierEmail: expense.supplier?.email || "",
    costId: expense.costId || "",
    costType: normalizedCostType(nonEmpty(expense.costType)),
    currency: expense.currency || "CNY",
    exchangeRate: Number(expense.exchangeRate || 1),
    exchangeRateDate: dateToInput(dateFromInput(expense.exchangeRateDate)),
    exchangeRateSource: expense.exchangeRateSource || "",
    exchangeRateType: expense.exchangeRateType || "",
	    amount: Number(expense.amount || 0),
	    amountCny: Number(expense.amountCny || 0),
	    containerType: expense.containerType || "",
	    appliedContainerCount: expense.appliedContainerCount == null ? 1 : Number(expense.appliedContainerCount || 1),
	    billingMethod: normalizeBillingMethodValue(expense.billingMethod),
	    billingQuantity: expense.billingQuantity == null
	      ? Number(expense.appliedContainerCount || 1)
	      : Number(expense.billingQuantity || 1),
	    containerScope: `${expense.billingQuantity == null ? Number(expense.appliedContainerCount || 1) : Number(expense.billingQuantity || 1)}`,
	    remark: expense.remark || "",
    auditStatus,
    invoiceStatus: expense.invoiceStatus || "未通知",
    paymentStatus: expense.paymentStatus || "待开票",
    billInvoiceStatus: bill.invoiceStatus || "",
    billPaymentStatus: bill.paymentStatus || "",
    submittedAt: logisticsExpenseBillField(expense, "submittedAt", expense.submittedAt) || null,
    submittedBy: serializeUser(bill.submittedBy),
    reviewedBy: serializeUser(bill.reviewedBy || expense.reviewedBy),
    reviewedAt: logisticsExpenseBillField(expense, "reviewedAt", expense.reviewedAt) || null,
    rejectedBy: auditStatus === "已驳回" ? serializeUser(bill.reviewedBy || expense.reviewedBy) : null,
    rejectedAt: auditStatus === "已驳回" ? (logisticsExpenseBillField(expense, "reviewedAt", expense.reviewedAt) || null) : null,
    reviewRemark: bill.reviewRemark || expense.reviewRemark || "",
    rejectReason: bill.rejectReason || expense.rejectReason || "",
    invoiceNotifiedAt: bill.invoiceNotifiedAt || expense.invoiceNotifiedAt || null,
    invoiceNotificationError: bill.invoiceNotificationError || expense.invoiceNotificationError || "",
    invoiceDocument,
    invoiceDocumentId: expense.invoiceDocumentId || "",
    invoiceUploadedBy: serializeUser(expense.invoiceUploadedBy),
    invoiceUploadedAt: expense.invoiceUploadedAt || null,
    invoiceConfirmedBy: serializeUser(expense.invoiceConfirmedBy),
    invoiceConfirmedAt: expense.invoiceConfirmedAt || null,
    forceConfirmReason: expense.forceConfirmReason || "",
    createdBy: serializeUser(expense.createdBy),
    updatedBy: serializeUser(expense.updatedBy),
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    order: orderSummary,
    sourceLabel: expense.costId ? "物流费用审核生成" : "供应商提交",
  };
}

export type LogisticsExpenseDto = ReturnType<typeof serializeLogisticsExpense>;

export function aggregateLogisticsExpenseStatus(rows: UnknownRecord[] = [], field = ""): string {
  if (field === "auditStatus") return logisticsExpenseBillAuditStatus(rows);
  const values = rows.map((row) => row[field]).filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) return "-";
  if (unique.length === 1) return nonEmpty(unique[0]);
  if (field === "invoiceStatus") {
    if (unique.includes("已上传")) return "部分已上传";
    if (unique.includes("已确认")) return "部分已确认";
    if (unique.includes("已通知开票")) return "部分已通知";
    if (unique.includes("未通知")) return "部分未通知";
  }
  if (field === "paymentStatus") {
    if (unique.includes("已付款")) return "部分已付款";
    if (unique.includes("待付款")) return "部分待付款";
    if (unique.includes("已开票")) return "部分已开票";
    if (unique.includes("待开票")) return "部分待开票";
  }
  return "混合状态";
}

export function logisticsExpenseBillAuditStatus(rows: LogisticsExpenseLike[] = []): string {
  const billStatuses = rows.map((row) => logisticsExpenseBillRecord(row).auditStatus).filter(Boolean);
  const uniqueBillStatuses = [...new Set(billStatuses)];
  if (uniqueBillStatuses.length === 1) return nonEmpty(uniqueBillStatuses[0]);
  const values = rows.map((row) => row.auditStatus || "草稿").filter(Boolean);
  const unique = [...new Set(values)];
  if (!unique.length) return "草稿";
  if (unique.length === 1) return nonEmpty(unique[0]);
  if (unique.includes("审核通过")) return "审核通过";
  if (unique.includes("待审核")) return "待审核";
  if (unique.includes("已驳回")) return "已驳回";
  return "草稿";
}

export function logisticsExpenseInvoiceGroups(items: LogisticsExpenseLike[] = []) {
  return logisticsInvoiceGroupsForExpenses(items).map((group) => {
    const groupItems = items.filter((item) => logisticsInvoiceGroupForExpense(item)?.key === group.key);
    const currencyTotals = summarizeCurrencyTotals(groupItems);
    const uploaded = groupItems.length > 0 && groupItems.every((item) => ["已上传", "已确认"].includes(item.invoiceStatus || ""));
    const confirmed = groupItems.length > 0 && groupItems.every((item) => item.invoiceStatus === "已确认");
    const failed = groupItems.some((item) => item.invoiceStatus === "通知失败");
    const notified = groupItems.some((item) => item.invoiceStatus === "已通知开票");
    return {
      key: group.key,
      label: group.label,
      costTypes: group.costTypes,
      amountCny: groupItems.reduce((sum, item) => sum + Number(item.amountCny || 0), 0),
      currencyTotals,
      itemIds: groupItems.map((item) => item.id).filter(Boolean),
      status: confirmed ? "已确认" : (uploaded ? "已上传" : (failed ? "通知失败" : (notified ? "已通知开票" : "待开票"))),
      uploaded,
      confirmed,
      failed,
      notified,
      invoiceDocumentId: groupItems.find((item) => item.invoiceDocumentId)?.invoiceDocumentId || "",
      invoiceNotificationError: groupItems.map((item) => item.invoiceNotificationError || "").find(Boolean) || "",
    };
  });
}

export function aggregateLogisticsExpenseInvoiceStatus(items: LogisticsExpenseLike[] = []) {
  const groups = logisticsExpenseInvoiceGroups(items);
  if (!groups.length) return aggregateLogisticsExpenseStatus(items, "invoiceStatus");
  if (groups.every((group) => group.confirmed)) return "已确认";
  if (groups.every((group) => group.uploaded || group.confirmed)) return "已上传发票";
  if (groups.some((group) => group.uploaded || group.confirmed)) return "部分上传发票";
  if (groups.some((group) => group.failed)) return "待开票 / 通知失败";
  return "待开票";
}

export function serializeLogisticsExpenseBill(rows: LogisticsExpenseLike[] = []) {
  const items = rows.map(serializeLogisticsExpense);
  const first = items[0] || {};
  const firstRaw = rows[0] || {};
  const bill = logisticsExpenseBillRecord(firstRaw);
  const amountCny = items.reduce((sum, item) => sum + Number(item.amountCny || 0), 0);
  const currencyTotals = summarizeCurrencyTotals(items);
  const invoiceGroups = logisticsExpenseInvoiceGroups(items);
  return {
    id: logisticsExpenseBillId(firstRaw || first),
    billId: logisticsExpenseBillId(firstRaw || first),
    isBill: true,
    orderId: first.orderId || "",
    orderNo: first.orderNo || "",
    blNo: first.blNo || first.billOfLadingNo || "",
    billOfLadingNo: first.billOfLadingNo || first.blNo || "",
    customerName: first.customerName || "",
    customerShortName: first.customerShortName || "",
    vesselVoyage: first.order?.vesselVoyage || "",
    supplierName: "",
    supplierNames: [...new Set(items.map((item) => item.supplierName).filter(Boolean))],
    costType: items.length === 1 ? items[0].costType : `${items.length} 项费用`,
    currency: "CNY",
    amount: currencyTotals.cnyActual,
    amountCny,
    currencyTotals,
    auditStatus: bill.auditStatus || aggregateLogisticsExpenseStatus(items, "auditStatus"),
    invoiceStatus: bill.invoiceStatus || aggregateLogisticsExpenseInvoiceStatus(items),
    paymentStatus: bill.paymentStatus || aggregateLogisticsExpenseStatus(items, "paymentStatus"),
    submittedAt: bill.submittedAt || first.submittedAt || null,
    submittedBy: serializeUser(bill.submittedBy),
    reviewedBy: serializeUser(bill.reviewedBy),
    reviewedAt: bill.reviewedAt || first.reviewedAt || null,
    rejectedBy: (bill.auditStatus || first.auditStatus) === "已驳回" ? serializeUser(bill.reviewedBy) : null,
    rejectedAt: (bill.auditStatus || first.auditStatus) === "已驳回" ? (bill.reviewedAt || first.reviewedAt || null) : null,
    reviewRemark: bill.reviewRemark || first.reviewRemark || "",
    rejectReason: bill.rejectReason || first.rejectReason || "",
    invoiceNotifiedAt: bill.invoiceNotifiedAt || first.invoiceNotifiedAt || null,
    invoiceNotificationError: bill.invoiceNotificationError || first.invoiceNotificationError || "",
    itemCount: items.length,
    invoiceGroups,
    items,
    order: first.order || {},
    updatedAt: rows.reduce((latest, row) => {
      const dateValue = logisticsExpenseBillRecord(row).updatedAt || row.updatedAt || row.createdAt || 0;
      const time = new Date(dateValue instanceof Date || typeof dateValue === "string" || typeof dateValue === "number" ? dateValue : 0).getTime();
      return time > latest ? time : latest;
    }, 0),
  };
}

export type LogisticsExpenseBillDto = ReturnType<typeof serializeLogisticsExpenseBill>;

export function serializeLogisticsExpenseShipment(rows: LogisticsExpenseLike[] = []) {
  const items = rows.map(serializeLogisticsExpense);
  const first = items[0] || {};
  const rawRows = rows.length ? rows : items;
  const bills = groupLogisticsExpensesByBill(rawRows);
  const currencyTotals = summarizeCurrencyTotals(items);
  const billIds = [...new Set(bills.map((bill) => nonEmpty(bill.billId || bill.id)).filter(Boolean))];
  const invoiceGroups = logisticsExpenseInvoiceGroups(items);
  const shipmentNo = first.orderNo || first.orderId || first.blNo || "";
  return {
    id: billIds.length === 1 ? billIds[0] : `shipment:${first.orderId || shipmentNo || "unknown"}`,
    shipmentNo,
    customer: first.customerShortName || first.customerName || "",
    isShipment: true,
    isBill: true,
    orderId: first.orderId || "",
    orderNo: first.orderNo || shipmentNo,
    blNo: [...new Set(items.map((item) => item.blNo || item.billOfLadingNo).filter(Boolean))].join(" / "),
    billOfLadingNo: [...new Set(items.map((item) => item.billOfLadingNo || item.blNo).filter(Boolean))].join(" / "),
    customerName: first.customerName || "",
    customerShortName: first.customerShortName || "",
    vesselVoyage: first.order?.vesselVoyage || "",
    supplierName: "",
    supplierNames: [...new Set(items.map((item) => item.supplierName).filter(Boolean))],
    costType: `${items.length} 项费用`,
    currency: "CNY",
    amount: currencyTotals.cnyActual,
    amountCny: currencyTotals.totalCny,
    totalCNY: currencyTotals.cnyActual,
    totalUSD: Number((currencyTotals.foreignTotals || []).find((item) => item.currency === "USD")?.amount || 0),
    currencyTotals,
    auditStatus: aggregateLogisticsExpenseStatus(items, "auditStatus"),
    invoiceStatus: aggregateLogisticsExpenseInvoiceStatus(items),
    paymentStatus: aggregateLogisticsExpenseStatus(items, "paymentStatus"),
    submittedAt: items.map((item) => item.submittedAt).find(Boolean) || null,
    reviewedBy: items.map((item) => item.reviewedBy).find((item) => item?.name),
    reviewedAt: items.map((item) => item.reviewedAt).find(Boolean) || null,
    reviewRemark: items.map((item) => item.reviewRemark || "").find(Boolean) || "",
    rejectReason: items.map((item) => item.rejectReason || "").find(Boolean) || "",
    invoiceNotifiedAt: items.map((item) => item.invoiceNotifiedAt).find(Boolean) || null,
    invoiceNotificationError: items.map((item) => item.invoiceNotificationError || "").find(Boolean) || "",
    itemCount: items.length,
    billCount: bills.length,
    shipmentBillIds: billIds,
    invoiceGroups,
    items,
    order: first.order || {},
    updatedAt: rows.reduce((latest, row) => {
      const dateValue = logisticsExpenseBillRecord(row).updatedAt || row.updatedAt || row.createdAt || 0;
      const time = new Date(dateValue instanceof Date || typeof dateValue === "string" || typeof dateValue === "number" ? dateValue : 0).getTime();
      return time > latest ? time : latest;
    }, 0),
  };
}

export type LogisticsExpenseShipmentDto = ReturnType<typeof serializeLogisticsExpenseShipment>;

export function groupLogisticsExpensesByShipment(rows: LogisticsExpenseLike[] = []) {
  const groups = new Map<string, LogisticsExpenseLike[]>();
  for (const row of rows) {
    const orderSummary = logisticsExpenseOrderSummary(row.order || {});
    const shipmentNo = nonEmpty(orderSummary.orderNo || row.orderId || orderSummary.blNo || "unknown");
    const key = row.orderId || orderSummary.orderId || shipmentNo;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.values())
    .map(serializeLogisticsExpenseShipment)
    .sort(compareLogisticsExpenseBillsForDisplay);
}

export function logisticsExpenseBillId(expense: LogisticsExpenseLike = {}) {
  const directBillId = nonEmpty(expense.billId || logisticsExpenseBillRecord(expense).id);
  if (directBillId) return directBillId;
  const orderSummary = expense.order?.orderId ? expense.order : logisticsExpenseOrderSummary(expense.order || {});
  return `bill:${expense.orderId || orderSummary.orderId || "order"}:${orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || "no-bl"}`;
}

export function groupLogisticsExpensesByBill(rows: LogisticsExpenseLike[] = []) {
  const groups = new Map<string, LogisticsExpenseLike[]>();
  for (const row of rows) {
    const orderSummary = logisticsExpenseOrderSummary(row.order || {});
    const key = row.billId || logisticsExpenseBillRecord(row).id || [row.orderId || orderSummary.orderId || "", orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || ""].join("::");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.values())
    .map(serializeLogisticsExpenseBill)
    .sort(compareLogisticsExpenseBillsForDisplay);
}

export function compareLogisticsExpenseBillsForDisplay(left: UnknownRecord = {}, right: UnknownRecord = {}) {
  return logisticsExpenseBillSortRank(left) - logisticsExpenseBillSortRank(right)
    || logisticsExpenseBillUpdatedAtValue(right) - logisticsExpenseBillUpdatedAtValue(left);
}

export function logisticsExpenseBillSortRank(bill: UnknownRecord = {}) {
  const auditStatus = normalizedLogisticsExpenseSortStatus(nonEmpty(bill.auditStatus || "草稿"));
  if (["草稿", "已驳回", "待审核"].includes(auditStatus)) return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus];

  const invoiceStatus = normalizedLogisticsExpenseSortStatus(nonEmpty(bill.invoiceStatus || "待开票"));
  const paymentStatus = normalizedLogisticsExpenseSortStatus(nonEmpty(bill.paymentStatus || "待开票"));
  const invoiceRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[invoiceStatus];
  if (Number.isFinite(invoiceRank) && invoiceRank < LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票) return invoiceRank;
  if (["部分付款", "部分已付款"].includes(paymentStatus)) return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.部分付款;
  if (paymentStatus === "已付款") return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已付款;
  if (Number.isFinite(invoiceRank) && invoiceRank === LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票) return invoiceRank;
  const paymentRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[paymentStatus];
  if (Number.isFinite(paymentRank)) return paymentRank;
  return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] || 999;
}

function normalizedLogisticsExpenseSortStatus(value = "") {
  const text = String(value || "").trim();
  if (text === "部分上传") return "部分上传发票";
  if (text === "部分已付款") return "部分付款";
  if (text === "已确认发票") return "已确认";
  return text || "草稿";
}

function logisticsExpenseBillUpdatedAtValue(bill: UnknownRecord = {}) {
  const value = bill.updatedAt || bill.createdAt || 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const dateValue = value instanceof Date || typeof value === "string" || typeof value === "number" ? value : 0;
  const time = new Date(dateValue).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function logisticsExpenseAccessWhere(actor: LogisticsActor): Prisma.LogisticsExpenseWhereInput {
  const role = actorRole(actor);
  const id = actorId(actor);
  if (role === "管理员") return {};
  if (role === "财务") return {
    OR: [
      { bill: { is: { auditStatus: "审核通过" } } },
      { billId: null, auditStatus: "审核通过" },
    ],
  };
  if (role === "业务员") return { order: { is: { customer: { is: { salespersonUserId: id } } } } };
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role)) {
    if (!actor) return { supplierId: "__no_supplier_bound__" };
    if (actor.supplierId) return { supplierId: actor.supplierId };
    return { supplierId: "__no_supplier_bound__" };
  }
  return { id: "__no_logistics_expense_access__" };
}

export function assertCanReadLogisticsExpenses(actor: LogisticsActor) {
  const role = actorRole(actor);
  if (role === "管理员" || role === "财务") return;
  if (canRead(actor, "domesticLogistics") || canRead(actor, "costs")) return;
  throw permissionError("无权限查看物流费用", 403);
}

export function assertCanWriteLogisticsExpense(actor: LogisticsActor) {
  if (canWrite(actor, "logistics")) return;
  throw permissionError("无权限录入物流费用", 403);
}

export function assertCanReviewLogisticsExpense(actor: LogisticsActor) {
  if (actorRole(actor) === "管理员") return;
  throw permissionError("只有管理员可以审核物流费用", 403);
}

export function assertCanConfirmLogisticsInvoice(actor: LogisticsActor) {
  if (["管理员", "财务"].includes(actorRole(actor))) return;
  throw permissionError("只有管理员或财务可以确认物流发票", 403);
}

export function logisticsExpenseStatusWhere(status = ""): Prisma.LogisticsExpenseWhereInput {
  const text = nonEmpty(status);
  if (!text || text === "all") return {};
  const auditWhere = (value: string): Prisma.LogisticsExpenseWhereInput => ({
    OR: [
      { bill: { is: { auditStatus: value } } },
      { billId: null, auditStatus: value },
    ],
  });
  const invoiceWhere = (value: string): Prisma.LogisticsExpenseWhereInput => {
    const billValue = value === "已上传" ? "已上传发票" : value;
    return {
      OR: [
        { bill: { is: { invoiceStatus: billValue } } },
        { billId: null, invoiceStatus: value },
      ],
    };
  };
  if (text === "pending") return auditWhere("待审核");
  if (text === "approved") return auditWhere("审核通过");
  if (text === "rejected") return auditWhere("已驳回");
  if (text === "draft") return auditWhere("草稿");
  if (text === "toInvoice") return {
    AND: [
      auditWhere("审核通过"),
      { OR: [{ bill: { is: { invoiceStatus: { in: ["未通知", "已通知开票", "待开票", "通知失败", "待开票 / 通知失败"] } } } }, { billId: null, invoiceStatus: { in: ["未通知", "已通知开票"] } }] },
    ],
  };
  if (text === "uploaded") return invoiceWhere("已上传发票");
  if (text === "confirmedInvoice") return invoiceWhere("已确认");
  if (LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(text)) return auditWhere(text);
  if (LOGISTICS_EXPENSE_INVOICE_STATUSES.includes(text)) return invoiceWhere(text);
  return {};
}

export function insensitiveContains(value: unknown): Prisma.StringFilter | null {
  const text = nonEmpty(value);
  return text ? { contains: text, mode: "insensitive" } : null;
}

export async function assertLogisticsExpenseOrder(input: UnknownRecord = {}, actor: LogisticsActor): Promise<LogisticsExpenseOrderForAccess> {
  const role = actorRole(actor);
  const id = actorId(actor);
  const supplierId = actorSupplierId(actor);
  const orderId = nonEmpty(input.orderId || input.order_id);
  const orderNo = nonEmpty(input.orderNo || input.order_no);
  const blNo = nonEmpty(input.blNo || input.billOfLadingNo || input.bill_of_lading_no);
  if (!orderId && !orderNo && !blNo) {
    throw codedError("未找到对应发货订单，请先建立或完善发货订单后再录入费用。", 400, "LOGISTICS_EXPENSE_ORDER_REQUIRED");
  }
  const orderFilters: Prisma.ReceivableOrderWhereInput[] = [];
  if (orderId) orderFilters.push({ id: orderId });
  if (orderNo) orderFilters.push({ orderNo: { equals: orderNo, mode: "insensitive" } });
  if (blNo) orderFilters.push({ blNo: { equals: blNo, mode: "insensitive" } });
  const order = await prisma.receivableOrder.findFirst({
    where: {
      deletedAt: null,
      OR: orderFilters,
    },
    include: {
      customer: true,
      salesperson: true,
      logisticsSuppliers: { include: { supplier: true } },
      domesticLogisticsInfos: {
        include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
      },
    },
  });
  if (!order) throw codedError("未找到对应发货订单，请先建立或完善发货订单后再录入费用。", 404, "LOGISTICS_EXPENSE_ORDER_NOT_FOUND");
  if (role === "管理员") return order;
  if (role === "业务员" && order.customer?.salespersonUserId === id) return order;
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role)) {
    if (supplierId && (order.logisticsSuppliers || []).some((row) => row.supplierId === supplierId)) return order;
  }
  throw permissionError("无权限访问该发货订单", 403);
}

export async function assertLogisticsExpenseSupplier(actor: LogisticsActor, order: LogisticsExpenseOrderForAccess, input: UnknownRecord = {}): Promise<LogisticsSupplierForExpense> {
  const role = actorRole(actor);
  const actorSupplier = actorSupplierId(actor);
  const requestedSupplierId = nonEmpty(input.supplierId || input.supplier_id);
  const supplierId = [LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role) && actorSupplier
    ? actorSupplier
    : requestedSupplierId;
  if (!supplierId) throw codedError("请选择物流供应商。", 400, "LOGISTICS_SUPPLIER_REQUIRED");
  const supplier = await assertSupplierActive(supplierId);
  if (!DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType)) {
    throw codedError("只有物流、报关、海运或港杂费用供应商可以提交物流费用。", 400, "LOGISTICS_SUPPLIER_TYPE_INVALID");
  }
  if (role !== "管理员") {
    if (!supplier.allowLogisticsExpenseEntry) throw codedError("该供应商尚未开启物流费用录入权限。", 403, "LOGISTICS_EXPENSE_ENTRY_DISABLED");
    if (!(order.logisticsSuppliers || []).some((row) => row.supplierId === supplier.id)) {
      throw codedError("该订单未分配给当前物流供应商，不能录入费用。", 403, "LOGISTICS_SUPPLIER_NOT_ASSIGNED");
    }
  }
  return supplier;
}

function assertSupplierCostTypeAllowed(actor: LogisticsActor, supplier: LogisticsSupplierForExpense, costType: string) {
  if (actorRole(actor) === "管理员") return;
  const allowed = expandLegacyFullLogisticsCostTypeList(supplier.allowedLogisticsCostTypes || []);
  if (!allowed.includes(costType)) {
    throw codedError(`当前供应商不能录入${costType}。`, 403, "LOGISTICS_COST_TYPE_NOT_ALLOWED");
  }
}

async function resolveLogisticsExpenseExchange(costType: string, input: UnknownRecord, actor: LogisticsActor, before: LogisticsExpenseLike | null = null) {
  const currency = logisticsCostTypeLocksCurrency(costType)
    ? "USD"
    : nonEmpty(input.currency || "CNY").toUpperCase();
  if (!CURRENCIES.includes(currency)) throw codedError("请选择有效币种。", 400, "CURRENCY_REQUIRED");
  if (logisticsCostTypeLocksCurrency(costType)) {
    const quote = await getExchangeRateQuote({
      currency,
      date: input.exchangeRateDate || input.rateDate || todayInputInChina(),
    }, exchangeActor(actor));
    const exchangeRate = Number(quote.rateToCny ?? quote.exchangeRate ?? quote.rate ?? 0);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw codedError("未找到可用美元汇率，请先刷新系统汇率。", 400, "EXCHANGE_RATE_REQUIRED");
    }
    return {
      currency,
      exchangeRate,
      exchangeRateDate: dateFromInput(quote.rateDate || input.exchangeRateDate || todayInputInChina()),
      exchangeRateSource: quote.source || "系统",
      exchangeRateType: quote.rateType || "",
    };
  }
  return resolveExchangeRateSnapshot(currency === "CNY"
    ? { ...input, currency: "CNY", exchangeRate: 1, exchangeRateSource: "系统", exchangeRateDate: input.exchangeRateDate || todayInputInChina() }
    : input, exchangeActor(actor), {
      currency,
      defaultDate: todayInputInChina(),
      allowHistoricalSource: before?.exchangeRateSource === "历史录入",
    });
}

export async function buildLogisticsExpenseData(
  order: LogisticsExpenseOrderForAccess,
  supplier: LogisticsSupplierForExpense,
  actor: LogisticsActor,
  input: UnknownRecord = {},
  before: LogisticsExpenseLike | null = null
) {
  const currentActorId = actorId(actor);
  const inputCostType = String(normalizedCostType(nonEmpty(input.costType)));
  const costType = LOGISTICS_COST_TYPES.includes(inputCostType) ? inputCostType : "";
  if (!costType) throw codedError("请选择有效物流费用类型。", 400, "LOGISTICS_EXPENSE_COST_TYPE_REQUIRED");
  assertSupplierCostTypeAllowed(actor, supplier, costType);
  const amount = requirePositive(input.amount, "物流费用金额");
  const exchange = await resolveLogisticsExpenseExchange(costType, {
    ...input,
    currency: logisticsCostTypeDefaultCurrency(costType) === "USD" ? "USD" : input.currency,
  }, actor, before);
  const beforeAuditStatus = before ? nonEmpty(logisticsExpenseBillRecord(before).auditStatus || before.auditStatus) : "";
  const requestedStatus = nonEmpty(input.auditStatus || input.status || (before ? beforeAuditStatus : (input.submit === false ? "草稿" : "待审核")));
  const auditStatus = LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(requestedStatus) ? requestedStatus : "待审核";
  if (beforeAuditStatus === "审核通过" && actorRole(actor) !== "管理员") {
    throw codedError("已审核通过的费用金额不能修改。", 403, "LOGISTICS_EXPENSE_APPROVED_LOCKED");
  }
  const billingMethod = normalizeLogisticsExpenseBillingMethod(input, before);
  const billingQuantity = normalizeLogisticsExpenseBillingQuantity(input, billingMethod, before);
  const appliedContainerCount = normalizeAppliedContainerCount(input, order, before, billingQuantity);
  const containerType = normalizeLogisticsExpenseContainerType(input, order, before);
  return {
    orderId: order.id,
    supplierId: supplier.id,
    supplierNameSnapshot: nonEmpty(supplier.supplierName),
    costType,
    currency: exchange.currency,
    exchangeRate: exchange.exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
	    amountCny: amountCny(amount, exchange.exchangeRate),
	    containerType,
	    appliedContainerCount,
	    billingMethod,
	    billingQuantity,
	    remark: optional(input.remark),
    auditStatus,
    submittedAt: auditStatus === "待审核"
      ? (dateFromInput(logisticsExpenseBillRecord(before || {}).submittedAt || before?.submittedAt) || new Date())
      : dateFromInput(logisticsExpenseBillRecord(before || {}).submittedAt || before?.submittedAt),
    invoiceStatus: before?.invoiceStatus || "未通知",
    paymentStatus: before?.paymentStatus || "待开票",
    rejectReason: auditStatus === "待审核" ? null : before?.rejectReason || null,
    updatedById: currentActorId || null,
    ...(before ? {} : { createdById: currentActorId || null }),
  };
}

export async function ensureLogisticsExpenseBill(
  order: LogisticsExpenseOrderForAccess,
  supplier: LogisticsSupplierForExpense | null,
  actor: LogisticsActor,
  input: UnknownRecord = {}
) {
  const billOfLadingNo = logisticsExpenseBillOfLadingNo(order);
  const billKey = logisticsExpenseBillKey(order.id, billOfLadingNo);
  if (!billKey) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_KEY_INVALID");
  const requestedStatus = nonEmpty(input.auditStatus || input.status || "草稿");
  const auditStatus = LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(requestedStatus) ? requestedStatus : "草稿";
  const now = new Date();
  return prisma.logisticsBill.upsert({
    where: { billKey },
    update: {
      updatedById: actorId(actor) || null,
      ...(auditStatus === "待审核" ? {
        auditStatus,
        submittedAt: dateFromInput(input.submittedAt) || now,
        submittedById: actorId(actor) || null,
        rejectReason: null,
        invoiceNotificationError: null,
      } : {}),
    },
    create: {
      billKey,
      orderId: order.id,
      supplierId: supplier?.id || null,
      billOfLadingNo,
      auditStatus,
      invoiceStatus: "未通知",
      paymentStatus: "待开票",
      submittedAt: auditStatus === "待审核" ? (dateFromInput(input.submittedAt) || now) : null,
      submittedById: auditStatus === "待审核" ? (actorId(actor) || null) : null,
      createdById: actorId(actor) || null,
      updatedById: actorId(actor) || null,
    },
  });
}

function normalizeBillingMethodValue(value: unknown): string {
  const text = nonEmpty(value || DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  return LOGISTICS_EXPENSE_BILLING_METHODS.includes(text) ? text : DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD;
}

function integerBillingMethod(method: unknown) {
  return ["按柜", "按票", "按次"].includes(normalizeBillingMethodValue(method));
}

function normalizeLogisticsExpenseBillingMethod(input: UnknownRecord = {}, before: LogisticsExpenseLike | null = null): string {
  const hasBillingMethodInput = Object.prototype.hasOwnProperty.call(input, "billingMethod")
    || Object.prototype.hasOwnProperty.call(input, "billing_method");
  if (!hasBillingMethodInput && before) return normalizeBillingMethodValue(before.billingMethod);
  const requested = nonEmpty(input.billingMethod ?? input.billing_method ?? DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD);
  if (!LOGISTICS_EXPENSE_BILLING_METHODS.includes(requested)) {
    throw codedError("请选择有效计费方式。", 400, "LOGISTICS_BILLING_METHOD_INVALID");
  }
  return requested;
}

function normalizeLogisticsExpenseBillingQuantity(input: UnknownRecord = {}, billingMethod = DEFAULT_LOGISTICS_EXPENSE_BILLING_METHOD, before: LogisticsExpenseLike | null = null): number {
  const hasQuantityInput = Object.prototype.hasOwnProperty.call(input, "billingQuantity")
    || Object.prototype.hasOwnProperty.call(input, "billing_quantity")
    || Object.prototype.hasOwnProperty.call(input, "appliedContainerCount")
    || Object.prototype.hasOwnProperty.call(input, "containerCount")
    || Object.prototype.hasOwnProperty.call(input, "applied_container_count");
  if (!hasQuantityInput && before) return Number(before.billingQuantity ?? before.appliedContainerCount ?? 1);
  const raw = input.billingQuantity ?? input.billing_quantity ?? input.appliedContainerCount ?? input.containerCount ?? input.applied_container_count;
  const text = nonEmpty(raw);
  if (!text || ["整票", "whole_shipment", "shipment", "all"].includes(text.toLowerCase())) return 1;
  const quantity = Number(text);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw codedError("适用数量/范围必须大于 0。", 400, "LOGISTICS_BILLING_QUANTITY_INVALID");
  }
  if (integerBillingMethod(billingMethod) && !Number.isInteger(quantity)) {
    throw codedError("按柜、按票、按次的适用数量/范围必须为正整数。", 400, "LOGISTICS_BILLING_QUANTITY_INTEGER_REQUIRED");
  }
  return quantity;
}

function normalizeLogisticsExpenseContainerType(input: UnknownRecord = {}, order: LogisticsOrderLike = {}, before: LogisticsExpenseLike | null = null): string | null {
  const hasContainerTypeInput = Object.prototype.hasOwnProperty.call(input, "containerType")
    || Object.prototype.hasOwnProperty.call(input, "container_type");
  if (!hasContainerTypeInput && before) return before.containerType || null;
  const requested = optional(input.containerType ?? input.container_type);
  if (!requested) return null;
  const summary = logisticsExpenseOrderSummary(order);
  const allowedTypes = summary.containerTypes || [];
  if (allowedTypes.length && !allowedTypes.includes(requested)) {
    throw codedError("请选择有效集装箱柜型。", 400, "LOGISTICS_CONTAINER_TYPE_INVALID");
  }
  return requested;
}

function normalizeAppliedContainerCount(input: UnknownRecord = {}, order: LogisticsOrderLike = {}, before: LogisticsExpenseLike | null = null, billingQuantity = 1): number {
  const hasContainerCountInput = Object.prototype.hasOwnProperty.call(input, "appliedContainerCount")
	    || Object.prototype.hasOwnProperty.call(input, "containerCount")
	    || Object.prototype.hasOwnProperty.call(input, "applied_container_count");
  if (!hasContainerCountInput && before) return Number(before.appliedContainerCount ?? 1);
  const raw = input.appliedContainerCount ?? input.containerCount ?? input.applied_container_count;
  const text = nonEmpty(raw);
  if (!text || ["整票", "whole_shipment", "shipment", "all"].includes(text.toLowerCase())) return Math.max(1, Math.ceil(Number(billingQuantity || 1)));
  const count = Number(text);
  if (!Number.isFinite(count) || count <= 0) {
	    throw codedError("适用数量必须为正整数。", 400, "LOGISTICS_CONTAINER_COUNT_INVALID");
  }
  return Math.max(1, Math.ceil(count));
}

export async function loadLogisticsExpenseForAction(id: string, actor: LogisticsActor) {
  const expense = await prisma.logisticsExpense.findFirst({
    where: {
      id,
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
  });
  if (!expense) throw permissionError("物流费用不存在或无权访问", 404);
  return expense;
}

export async function createOrUpdateCostFromLogisticsExpense(tx: Prisma.TransactionClient | typeof prisma, expense: LogisticsExpenseForCostSync, actor: LogisticsActor) {
  const costType = String(normalizedCostType(nonEmpty(expense.costType)));
  const currentActorId = actorId(actor);
  const duplicate = await tx.orderCost.findFirst({
    where: {
      orderId: expense.orderId,
      costType,
      deletedAt: null,
      NOT: { sourceId: expense.id },
    },
  });
  if (duplicate) {
    throw codedError("同一订单同一物流费用类型已存在正式成本，不能重复进入成本。", 409, "LOGISTICS_EXPENSE_DUPLICATE_COST");
  }
  const costData = {
    orderId: expense.orderId,
    supplierId: expense.supplierId,
    supplierNameSnapshot: expense.supplierNameSnapshot || expense.supplier?.supplierName || "",
    vendorName: expense.supplierNameSnapshot || expense.supplier?.supplierName || "",
    costType,
    currency: nonEmpty(expense.currency || "CNY"),
    exchangeRate: expense.exchangeRate ?? 1,
    exchangeRateDate: dateFromInput(expense.exchangeRateDate),
    exchangeRateSource: expense.exchangeRateSource,
    exchangeRateType: expense.exchangeRateType,
    amount: expense.amount ?? 0,
    amountCny: expense.amountCny ?? 0,
    paymentStatus: "待支付",
    costConfirmed: true,
    costConfirmedAt: new Date(),
    paymentDate: null,
    invoiceStatus: "未通知",
    sourceType: "LOGISTICS_EXPENSE",
    sourceId: expense.id,
    remark: expense.remark || "",
    updatedById: currentActorId || null,
  };
  const existing = expense.costId
    ? await tx.orderCost.findFirst({ where: { id: expense.costId, deletedAt: null } })
    : await tx.orderCost.findFirst({ where: { sourceType: "LOGISTICS_EXPENSE", sourceId: expense.id, deletedAt: null } });
  if (existing) return tx.orderCost.update({ where: { id: existing.id }, data: costData });
  return tx.orderCost.create({ data: { ...costData, createdById: currentActorId || null } });
}

export {
  LOGISTICS_OPERATOR_ROLE,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
};
