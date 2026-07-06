import { dateToInput, logServerError } from "./shared-base-utils";
import { ORDER_COST_STATUS_VOID, isLogisticsGeneratedCostSourceType, normalizedCostType } from "./shared-constants";
import { serializeUser } from "./shared-users";
import { businessEntityFieldsFromOrder } from "./business-entities";
import { managedFileDownloadPath } from "./file-center";
import {
  type CostLike,
  type OrderDocumentStatusLike,
  type PaymentLike,
  asLooseRecord,
  dateTimeToIso,
} from "./shared-serialization-types";
import { customerBusinessName, customerFullName, customerShortName } from "./shared-serialization-parties";
import { serializeOrderDocument } from "./shared-serialization-documents";

export function serializePayment(paymentInput: unknown) {
  const payment = asLooseRecord<PaymentLike>(paymentInput);
  return {
    id: payment.id,
    orderId: payment.orderId,
    orderNo: payment.order?.orderNo || "",
    customerName: customerBusinessName(payment.order?.customer, payment.order?.customerNameSnapshot),
    customerFullName: customerFullName(payment.order?.customer, payment.order?.customerNameSnapshot),
    customerShortName: customerShortName(payment.order?.customer),
    ...businessEntityFieldsFromOrder(payment.order),
    country: payment.order?.customer?.country || payment.order?.country || "",
    salespersonName: payment.order?.salesperson?.name || "",
    taxArchived: Boolean(payment.order?.taxArchived || payment.order?.taxRefundStatus === "SUBMITTED"),
    taxRefundStatus: payment.order?.taxRefundStatus || "",
    paymentDate: dateToInput(payment.paymentDate),
    currency: payment.currency,
    exchangeRate: Number(payment.exchangeRate),
    exchangeRateDate: dateToInput(payment.exchangeRateDate),
    exchangeRateSource: payment.exchangeRateSource || "",
    exchangeRateType: payment.exchangeRateType || "",
    amount: Number(payment.amount),
    amountCny: Number(payment.amountCny),
    paymentType: payment.paymentType || "",
    status: payment.status,
    bankReference: payment.bankReference || "",
    remark: payment.remark || "",
    createdBy: serializeUser(payment.createdBy),
    updatedBy: serializeUser(payment.updatedBy),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export function invoiceStatusFromDocuments(documents: OrderDocumentStatusLike[] = []) {
  return documents.some((document) => (
    document.documentType === "SUPPLIER_INVOICE"
    && document.uploadStatus === "SUCCESS"
    && !document.deletedAt
  )) ? "已收到" : "未收到";
}

function serializedCostPaid(cost: CostLike) {
  return Boolean(cost.paid)
    || Boolean(cost.paidAt)
    || Boolean(cost.paymentDate)
    || cost.paymentStatus === "已支付"
    || cost.paymentStatus === "部分支付";
}

function serializedCostHasVoucher(cost: CostLike) {
  return Boolean(cost.paymentVoucherStorageKey || cost.paymentVoucherUrl || cost.paymentVoucherFileName);
}

function serializedCostUploadedDocument(cost: CostLike) {
  return (cost.documents || []).some((document) => (
    !document.deletedAt
    && (document.uploadStatus === "SUCCESS" || Boolean(document.factoryDocumentRequestId))
  ));
}

function serializedCostTaxLinked(cost: CostLike) {
  const order = cost.order;
  const taxStatus = String(order?.taxRefundStatus || "").trim();
  return Boolean(order?.taxArchived || order?.taxRefundArchivedAt || (taxStatus && taxStatus !== "NOT_READY"));
}

function serializedCostProfitLinked(cost: CostLike) {
  const order = cost.order;
  return ["已结算", "SETTLED"].includes(String(order?.commissionStatus || "").trim())
    || Boolean((order?.commissionSettlementRecords || []).length);
}

function serializedCostSupplierRequestLinked(cost: CostLike) {
  return (cost.supplierDocumentRequests || []).some((request) => !request.deletedAt);
}

function serializedCostDeleteBlockedReasons(cost: CostLike) {
  const reasons: string[] = [];
  if (cost.status === ORDER_COST_STATUS_VOID) reasons.push("成本已作废");
  if (String(cost.paymentStatus || "").trim() !== "待支付") reasons.push("付款状态不是待支付");
  if (serializedCostPaid(cost)) reasons.push("已存在付款记录");
  if (serializedCostHasVoucher(cost)) reasons.push("已存在付款凭证");
  if (serializedCostUploadedDocument(cost)) reasons.push("已存在成本附件或发票资料");
  if (serializedCostTaxLinked(cost)) reasons.push("订单已进入退税流程");
  if (serializedCostSupplierRequestLinked(cost)) reasons.push("已关联资料回传任务");
  if (serializedCostProfitLinked(cost)) reasons.push("已关联利润或提成结算");
  if (cost.costConfirmed) reasons.push("成本已确认");
	if (isLogisticsGeneratedCostSourceType(cost.sourceType) || cost.generatedLogisticsExpense) reasons.push("物流费用同步成本不能在成本管理物理删除");
  return [...new Set(reasons)];
}

export function fallbackSerializedCost(costInput: unknown = {}) {
  const cost = asLooseRecord<CostLike>(costInput);
  const deleteBlockedReasons = serializedCostDeleteBlockedReasons(cost);
  return {
    id: cost.id,
    orderId: cost.orderId,
    costType: normalizedCostType(String(cost.costType || "")),
    costTypeRaw: cost.costType,
    supplierId: cost.supplierId || "",
    supplierName: cost.supplierNameSnapshot || cost.vendorName || "",
    supplierNameSnapshot: cost.supplierNameSnapshot || cost.vendorName || "",
    vendorName: cost.supplierNameSnapshot || cost.vendorName || "",
    currency: cost.currency || "CNY",
    exchangeRate: Number(cost.exchangeRate || 1),
    amount: Number(cost.amount || 0),
    amountCny: Number(cost.amountCny || 0),
    status: cost.status || "ACTIVE",
    voidedAt: dateTimeToIso(cost.voidedAt),
    voidedById: cost.voidedById || "",
    voidReason: cost.voidReason || "",
    restoredAt: dateTimeToIso(cost.restoredAt),
    restoredById: cost.restoredById || "",
    restoreReason: cost.restoreReason || "",
    canDeleteCost: deleteBlockedReasons.length === 0,
    deleteBlockedReasons,
    paymentStatus: cost.paymentStatus || "待支付",
    costConfirmed: Boolean(cost.costConfirmed),
    paymentDate: dateToInput(cost.paymentDate),
    paid: Boolean(cost.paid),
    paidAt: dateTimeToIso(cost.paidAt),
    paymentVoucherUrl: cost.paymentVoucherStorageKey && cost.id ? managedFileDownloadPath("payment-voucher", String(cost.id)) : (cost.paymentVoucherUrl || ""),
    paymentVoucherFileName: cost.paymentVoucherFileName || "",
    paymentVoucherMimeType: cost.paymentVoucherMimeType || "",
    paymentVoucherUploadedAt: dateTimeToIso(cost.paymentVoucherUploadedAt),
		invoiceStatus: isLogisticsGeneratedCostSourceType(cost.sourceType)
			? (cost.invoiceStatus || invoiceStatusFromDocuments(cost.documents || []))
			: invoiceStatusFromDocuments(cost.documents || []),
    sourceType: cost.sourceType || "MANUAL",
    sourceId: cost.sourceId || "",
		sourceLabel: isLogisticsGeneratedCostSourceType(cost.sourceType) ? "物流费用审核生成" : "人工录入",
    remark: cost.remark || "",
    documents: [],
    createdAt: cost.createdAt,
    updatedAt: cost.updatedAt,
  };
}

export function safeSerializeCost(costInput: unknown = {}) {
  const cost = asLooseRecord<CostLike>(costInput);
  try {
    return serializeCost(cost);
  } catch (error) {
    logServerError("成本返回数据序列化失败", error, { costId: cost?.id || "" });
    return fallbackSerializedCost(cost);
  }
}

export function serializeCost(costInput: unknown) {
  const cost = asLooseRecord<CostLike>(costInput);
  const deleteBlockedReasons = serializedCostDeleteBlockedReasons(cost);
  const costDocuments = (cost.documents || []).map((document) => ({
    ...document,
    cost: document.cost || cost,
    costType: document.cost?.costType || cost.costType,
  }));
  return {
    id: cost.id,
    orderId: cost.orderId,
    orderNo: cost.order?.orderNo || "",
    blNo: cost.order?.blNo || "",
    billOfLadingNo: cost.order?.blNo || "",
    customerId: cost.order?.customerId || "",
    customerName: customerBusinessName(cost.order?.customer, cost.order?.customerNameSnapshot),
    customerFullName: customerFullName(cost.order?.customer, cost.order?.customerNameSnapshot),
    customerShortName: customerShortName(cost.order?.customer),
    ...businessEntityFieldsFromOrder(cost.order),
    country: cost.order?.customer?.country || cost.order?.country || "",
    salespersonName: cost.order?.salesperson?.name || "",
    orderCurrency: cost.order?.currency || "",
    orderExchangeRate: Number(cost.order?.exchangeRate || 0),
    orderStatus: cost.order?.status || "",
    taxArchived: Boolean(cost.order?.taxArchived || cost.order?.taxRefundStatus === "SUBMITTED"),
    taxRefundStatus: cost.order?.taxRefundStatus || "",
    supplierId: cost.supplierId || "",
    supplierName: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierNameSnapshot: cost.supplierNameSnapshot || cost.supplier?.supplierName || cost.vendorName || "",
    supplierType: cost.supplier?.supplierType || "",
    costType: normalizedCostType(String(cost.costType || "")),
    costTypeRaw: cost.costType,
    vendorName: cost.supplierNameSnapshot || cost.vendorName,
    currency: cost.currency,
    exchangeRate: Number(cost.exchangeRate),
    exchangeRateDate: dateToInput(cost.exchangeRateDate),
    exchangeRateSource: cost.exchangeRateSource || "",
    exchangeRateType: cost.exchangeRateType || "",
    amount: Number(cost.amount),
    amountCny: Number(cost.amountCny),
    status: cost.status || "ACTIVE",
    voidedAt: dateTimeToIso(cost.voidedAt),
    voidedById: cost.voidedById || "",
    voidReason: cost.voidReason || "",
    restoredAt: dateTimeToIso(cost.restoredAt),
    restoredById: cost.restoredById || "",
    restoreReason: cost.restoreReason || "",
    canDeleteCost: deleteBlockedReasons.length === 0,
    deleteBlockedReasons,
    paymentStatus: cost.paymentStatus,
    costConfirmed: Boolean(cost.costConfirmed),
    costConfirmedAt: cost.costConfirmedAt,
    paymentDate: dateToInput(cost.paymentDate),
    paid: Boolean(cost.paid),
    paidAt: dateTimeToIso(cost.paidAt),
    paymentVoucherUrl: cost.paymentVoucherStorageKey && cost.id ? managedFileDownloadPath("payment-voucher", String(cost.id)) : (cost.paymentVoucherUrl || ""),
    paymentVoucherFileName: cost.paymentVoucherFileName || "",
    paymentVoucherMimeType: cost.paymentVoucherMimeType || "",
    paymentVoucherUploadedAt: dateTimeToIso(cost.paymentVoucherUploadedAt),
		invoiceStatus: isLogisticsGeneratedCostSourceType(cost.sourceType)
			? (cost.invoiceStatus || invoiceStatusFromDocuments(cost.documents || []))
			: invoiceStatusFromDocuments(cost.documents || []),
    sourceType: cost.sourceType || "MANUAL",
    sourceId: cost.sourceId || "",
		sourceLabel: isLogisticsGeneratedCostSourceType(cost.sourceType) ? "物流费用审核生成" : "人工录入",
    remark: cost.remark || "",
    createdBy: serializeUser(cost.createdBy),
    updatedBy: serializeUser(cost.updatedBy),
    documents: costDocuments.map((document) => serializeOrderDocument(document, {
      ...(cost.order || {}),
      id: cost.orderId || cost.order?.id,
      orderNo: cost.order?.orderNo || cost.orderNo || "",
      blNo: cost.order?.blNo || cost.blNo || "",
      documents: costDocuments,
    })),
    createdAt: cost.createdAt,
    updatedAt: cost.updatedAt,
  };
}
