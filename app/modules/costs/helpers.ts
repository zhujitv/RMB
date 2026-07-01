import { summarizeCurrencyTotals, type CurrencyTotals } from "../../../lib/platform/currency-totals";
import { customerDisplayName } from "../../utils";
import { FACTORY_COST_TYPES, FACTORY_DOCUMENT_TYPES, LOGISTICS_INVOICE_COST_TYPES, PRODUCT_SUPPLIER_TYPES, emptyCostItemForm, emptyQuickCostForm, type CostDocument, type CostFormDrawerState, type CostInvoiceGroupRow, type CostItemForm, type CostOrderOption, type CostOrderSummary, type CostRow, type CostView, type QuickCostForm, type SupplierOption, type PaymentVoucherPreviewKind } from "./model";

export function costDocumentTypesForDrawer(cost: CostRow) {
  if (isFactoryCost(cost)) return FACTORY_DOCUMENT_TYPES;
  if (isLogisticsInvoiceCost(cost)) {
    return [{ value: "SUPPLIER_INVOICE", label: logisticsInvoiceLabel(cost), required: true }];
  }
  return [{ value: "SUPPLIER_INVOICE", label: "发票资料", required: false }];
}

export function documentsForType(cost: CostRow, documentType: string) {
  return (cost.documents || []).filter((document) => (
    document.documentType === documentType
    && document.uploadStatus === "SUCCESS"
    && (!document.costId || document.costId === cost.id)
  ));
}

export function isFactoryCost(cost: CostRow) {
  return PRODUCT_SUPPLIER_TYPES.includes(cost.supplierType || "") || FACTORY_COST_TYPES.includes(cost.costType || "");
}

export function isLogisticsInvoiceCost(cost: CostRow) {
  return LOGISTICS_INVOICE_COST_TYPES.includes(cost.costType || "");
}

export function isLogisticsGeneratedCost(cost: Pick<CostRow, "sourceType">) {
  return cost.sourceType === "LOGISTICS_EXPENSE";
}

export function isProductSupplierPaymentEnabled(cost: CostRow) {
  return isFactoryCost(cost) && !isLogisticsGeneratedCost(cost) && !isLogisticsInvoiceCost(cost);
}

export function isProductSupplierPaid(cost: CostRow) {
  return Boolean(cost.paid) || cost.paymentStatus === "已支付" || cost.paymentStatus === "部分支付";
}

export function isProductSupplierPaymentFormLocked(item: Pick<CostItemForm, "costType">, supplier: SupplierOption | null, canManageFactoryPayments: boolean) {
  if (canManageFactoryPayments) return false;
  return FACTORY_COST_TYPES.includes(item.costType) || PRODUCT_SUPPLIER_TYPES.includes(supplier?.supplierType || "");
}

export function logisticsInvoiceLabel(cost: Pick<CostRow, "costType">) {
  if (["拖车费", "国内物流费", "国内拖车费"].includes(cost.costType || "")) return "拖车费发票";
  if (cost.costType === "报关费") return "报关费发票";
  if (cost.costType === "港杂费") return "港杂费发票";
  if (cost.costType === "海运费") return "海运费发票";
  return "物流发票";
}

export function costUploadKey(cost: CostRow, documentType: string) {
  return [cost.orderId || "", cost.id, cost.supplierId || "", documentType].join(":");
}

export function paymentVoucherUploadKey(cost: CostRow) {
  return [cost.id, "payment-voucher"].join(":");
}

export function paymentVoucherDownloadUrl(cost: Pick<CostRow, "id" | "paymentVoucherUrl" | "paymentVoucherFileName">, disposition: "inline" | "attachment" = "inline") {
  const baseUrl = cost.id && (cost.paymentVoucherFileName || cost.paymentVoucherUrl)
    ? `/api/files/payment-voucher/${encodeURIComponent(cost.id)}/download`
    : (cost.paymentVoucherUrl || "");
  if (!baseUrl || disposition === "inline") return baseUrl;
  return baseUrl;
}

export function hasPaymentVoucher(cost: Pick<CostRow, "id" | "paymentVoucherUrl" | "paymentVoucherFileName">) {
  return Boolean(paymentVoucherDownloadUrl(cost));
}

export function singlePaymentVoucherCost(costs: CostRow[]) {
  const voucherCosts = costs.filter(hasPaymentVoucher);
  return voucherCosts.length === 1 ? voucherCosts[0] : null;
}

export function previewKindFromContentType(contentType = ""): PaymentVoucherPreviewKind | null {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("application/pdf")) return "pdf";
  if (normalized.startsWith("image/")) return "image";
  return null;
}

export function inferPaymentVoucherPreviewKind(cost: Pick<CostRow, "paymentVoucherFileName" | "paymentVoucherMimeType">): PaymentVoucherPreviewKind | null {
  const mimeKind = previewKindFromContentType(cost.paymentVoucherMimeType || "");
  if (mimeKind) return mimeKind;
  const fileName = String(cost.paymentVoucherFileName || "").toLowerCase();
  if (fileName.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp)$/.test(fileName)) return "image";
  return null;
}

export function dateTimeLocalValue(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function dateTimeLocalToIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function costFormFromRow(cost?: CostRow | null): QuickCostForm {
  if (!cost) return { ...emptyQuickCostForm };
  return {
    orderId: cost.orderId || "",
  };
}

export function costItemFromRow(cost?: CostRow | null): CostItemForm {
  if (!cost) return emptyCostItemForm();
  return {
    ...emptyCostItemForm(),
    supplierId: cost.supplierId || "",
    costType: cost.costType || "工厂货款",
    amount: cost.amount == null ? "" : String(cost.amount),
    currency: cost.currency || "CNY",
    exchangeRate: cost.exchangeRate == null ? "1" : String(cost.exchangeRate),
    paymentStatus: cost.paymentStatus || "待支付",
    paymentDate: cost.paymentDate || "",
    costConfirmed: cost.costConfirmed ? "true" : "false",
    remark: cost.remark || "",
  };
}

export function initialSupplierFromCost(cost?: CostRow | null): SupplierOption | null {
  if (!cost?.supplierId) return null;
  return {
    id: cost.supplierId,
    supplierName: cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商",
    name: cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商",
    supplierType: cost.supplierType || "",
  };
}

export function costSupplierName(cost: Pick<CostRow, "supplierName" | "supplierNameSnapshot" | "vendorName"> | null | undefined) {
  return cost?.supplierName || cost?.supplierNameSnapshot || cost?.vendorName || "-";
}

export function exchangeRateMeta(currency?: string) {
  return (currency || "CNY").toUpperCase() === "CNY" ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" : "汇率来源：待获取";
}

export function currencyTotalAmount(summary: CurrencyTotals | null | undefined, currency: string, fallback = 0) {
  const normalized = String(currency || "CNY").toUpperCase();
  if (normalized === "CNY") return Number(summary?.cnyActual ?? fallback ?? 0);
  return Number((summary?.foreignTotals || []).find((item) => String(item.currency || "").toUpperCase() === normalized)?.amount || 0);
}

export function orderLabel(order: CostOrderOption) {
  const customer = customerDisplayName(order);
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}

export function supplierLabel(supplier: SupplierOption) {
  const name = supplier.supplierName || supplier.name || "未命名供应商";
  return supplier.supplierType ? `${name} / ${supplier.supplierType}` : name;
}
