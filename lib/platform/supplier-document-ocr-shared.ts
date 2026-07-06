import { Prisma } from "../generated/prisma/client.js";
import { writeAudit } from "./shared-audit";
import {
  codedError,
  isPlainRecord,
  nonEmpty,
} from "./shared-base-utils";
import {
  selectBestContractOrderNo,
} from "./supplier-contract-order-match";
import {
  parseVatInvoiceFields as parseVatInvoiceFieldsCore,
} from "./supplier-vat-invoice-parser";

export type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
} | null | undefined;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type OcrDocumentRow = Prisma.OrderDocumentGetPayload<{
  include: {
    order: { include: { businessEntity: true } };
    supplier: true;
    cost: true;
    factoryDocumentRequest: {
      include: {
        order: {
          include: {
            businessEntity: true;
            costs: { where: { deletedAt: null; status: { not: "VOID" } }; include: { supplier: true } };
          };
        };
        supplier: true;
      };
    };
  };
}>;
export type OcrTaskRow = Prisma.OcrTaskGetPayload<{ include: { results: true } }>;

export const SUPPLIER_DOCUMENT_OCR_MODULE = "SUPPLIER_DOCUMENT_RETURN";
export const SUPPLIER_DOCUMENT_OCR_FEATURE = "supplierDocumentReturn";
export const SUPPLIER_DOCUMENT_OCR_TYPES = ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"];
export const OCR_STATUS_PROCESSING = "OCR识别中";
export const OCR_STATUS_PASSED = "OCR识别成功，校验通过";
export const OCR_STATUS_EXCEPTION = "OCR识别成功，存在异常";
export const OCR_STATUS_FAILED = "OCR识别失败，需人工核对";
export const OCR_STATUS_MANUAL = "待人工确认";
export const OCR_STALE_PROCESSING_MESSAGE = "OCR识别超时，请点击重新识别或人工核对。";
export const OCR_NETWORK_FAILURE_MESSAGE = "OCR 连接超时，请稍后点击“重新识别”；如仍失败，请先人工核对该文件。";
export const OCR_CONFIG_FAILURE_MESSAGE = "OCR 配置缺失，请联系管理员到系统设置检查 OCR 配置。";
export const OCR_PERMISSION_FAILURE_MESSAGE = "OCR AccessKey/Secret 配置错误或接口权限不足，请联系管理员。";
export const OCR_QUOTA_FAILURE_MESSAGE = "OCR 额度不足或调用频率受限，请检查阿里云账户额度。";
export const OCR_FILE_FAILURE_MESSAGE = "文件无法读取，请重新上传 PDF 后再识别。";
export const OCR_PDF_FAILURE_MESSAGE = "PDF 处理失败，请重新上传清晰、未加密的 PDF。";
export const OCR_STRUCTURE_FAILURE_MESSAGE = "OCR 返回结构异常，请点击重新识别或人工确认。";
export const OCR_PROVIDER_FAILURE_MESSAGE = "阿里云 OCR 返回异常，请稍后重新识别；管理员可根据服务端日志排查。";
export const OCR_RERUN_CANCELLED_MESSAGE = "已重新发起识别，旧识别任务已取消。";
export const VALIDATION_PASSED = "PASSED";
export const VALIDATION_EXCEPTION = "EXCEPTION";
export const VALIDATION_FAILED = "FAILED";
export const VALIDATION_MANUAL = "PENDING_MANUAL";
export const VALIDATION_CONFIRMED = "MANUAL_CONFIRMED";
export const VALIDATION_REJECTED = "REJECTED";
export const INTERNAL_OCR_ROLES = ["管理员", "财务", "业务员", "采购"];
export const DEFAULT_SUPPLIER_OCR_PROCESSING_STALE_MS = 2 * 60 * 1000;
export const DEFAULT_SUPPLIER_OCR_TASK_TIMEOUT_MS = 50 * 1000;

export type ValidationIssue = {
  level: "error" | "warning" | "manual";
  message: string;
  field?: string;
};
export type FieldResult = {
  key: string;
  label: string;
  value: string;
};
export type OcrValidationContext = {
  document: OcrDocumentRow;
  supplierName: string;
  supplierTaxNo: string;
  businessEntityName: string;
  orderNo: string;
  purchaseOrderNo: string;
  expectedAmount: number;
};

export function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function supplierOcrProcessingStaleMs() {
  const configured = Number.parseInt(String(process.env.SUPPLIER_DOCUMENT_OCR_STALE_MS || ""), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SUPPLIER_OCR_PROCESSING_STALE_MS;
}

export function supplierOcrTaskTimeoutMs() {
  const configured = Number.parseInt(String(process.env.SUPPLIER_DOCUMENT_OCR_TASK_TIMEOUT_MS || ""), 10);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_SUPPLIER_OCR_TASK_TIMEOUT_MS;
  return Math.min(Math.max(configured, 15_000), 55_000);
}

export function supplierOcrErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

export function supplierOcrErrorCode(error: unknown) {
  return String((error as { code?: unknown } | null)?.code || "");
}

export function supplierOcrErrorDetails(error: unknown) {
  const details = (error as { details?: unknown } | null)?.details;
  return isPlainRecord(details) ? details : {};
}

export function supplierOcrFailureTechnicalDetails(error: unknown) {
  const details = supplierOcrErrorDetails(error);
  return {
    code: supplierOcrErrorCode(error),
    message: supplierOcrErrorText(error),
    provider: cleanText(details.provider),
    apiName: cleanText(details.apiName),
    requestId: cleanText(details.requestId),
    httpStatus: cleanText(details.httpStatus),
    errorCode: cleanText(details.errorCode),
    errorMessage: cleanText(details.errorMessage),
    endpoint: cleanText(details.endpoint),
    region: cleanText(details.region),
    responseBody: cleanText(details.responseBody).slice(0, 1000),
  };
}

export function supplierOcrFailureHaystack(error: unknown) {
  const details = supplierOcrFailureTechnicalDetails(error);
  return [
    details.code,
    details.message,
    details.provider,
    details.apiName,
    details.requestId,
    details.httpStatus,
    details.errorCode,
    details.errorMessage,
    details.responseBody,
  ].join(" ");
}

export function isSupplierOcrNetworkError(error: unknown) {
  return /(SUPPLIER_DOCUMENT_OCR_TASK_TIMEOUT|ConnectTimeout|ReadTimeout|Timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|Connect HTTPS|504\b)/i.test(supplierOcrFailureHaystack(error));
}

export function supplierDocumentOcrFailureKind(error: unknown) {
  const code = supplierOcrErrorCode(error);
  const text = supplierOcrFailureHaystack(error);
  if (/(SUPPLIER_DOCUMENT_FILE_MISSING|FILE_SIGNATURE_INVALID|FILE_REQUIRED|NoSuchKey|NoSuchBucket|R2|storage|readR2Object|文件.*(不存在|失效|无法访问)|Object not found)/i.test(text)) {
    return "FILE_READ_FAILED";
  }
  if (/(FILE_TOO_LARGE|RequestEntityTooLarge|EntityTooLarge|PayloadTooLarge|超过.*(大小|限制)|too large|file size)/i.test(text)) {
    return "PDF_TOO_LARGE";
  }
  if (/(PDF.*(处理|转换|渲染|解析)|pdfjs|rasterize|canvas|InvalidPDF|encrypted|password|加密|损坏|corrupt)/i.test(text)) {
    return "PDF_PROCESS_FAILED";
  }
  if (/(OCR_ACCESS_KEY_REQUIRED|OCR_CREDENTIAL_REQUIRED|OCR_PROVIDER_ADAPTER_NOT_CONFIGURED|OCR_FEATURE_DISABLED|配置缺失|未配置|启用 OCR 前|feature.*disabled)/i.test(text)) {
    return "CONFIG_MISSING";
  }
  if (/(ocrServiceNotOpen|not activated the OCR service|not activated|未开通|未启用|InvalidAccessKeyId|SignatureDoesNotMatch|Unauthorized|Forbidden|AccessDenied|NoPermission|InvalidSecurityToken|401\b|403\b|AccessKey|Secret)/i.test(text)) {
    return "AUTH_FAILED";
  }
  if (/(Quota|Throttling|TooManyRequests|QPS|LimitExceeded|Insufficient|Balance|Arrear|Credit|额度|配额|欠费|余额|429\b)/i.test(text)) {
    return "QUOTA_LIMITED";
  }
  if (isSupplierOcrNetworkError(error)) return "TIMEOUT";
  if (/(NO_TEXT|PARSE_FAILED|STRUCTURE|结构异常|返回结构|未返回|not return|empty|OCR原文未识别|OCR原文已识别但解析失败|解析失败)/i.test(text)) {
    return "STRUCTURE_INVALID";
  }
  if (code === "ALIYUN_OCR_SERVICE_UNAVAILABLE") return "ALIYUN_PROVIDER_ERROR";
  return "UNKNOWN";
}

export function supplierDocumentOcrFailureMessageForKind(kind: string) {
  if (kind === "TIMEOUT") return OCR_NETWORK_FAILURE_MESSAGE;
  if (kind === "CONFIG_MISSING") return OCR_CONFIG_FAILURE_MESSAGE;
  if (kind === "AUTH_FAILED") return OCR_PERMISSION_FAILURE_MESSAGE;
  if (kind === "QUOTA_LIMITED") return OCR_QUOTA_FAILURE_MESSAGE;
  if (kind === "FILE_READ_FAILED") return OCR_FILE_FAILURE_MESSAGE;
  if (kind === "PDF_TOO_LARGE") return "PDF 超过大小限制，请压缩后重新上传。";
  if (kind === "PDF_PROCESS_FAILED") return OCR_PDF_FAILURE_MESSAGE;
  if (kind === "STRUCTURE_INVALID") return OCR_STRUCTURE_FAILURE_MESSAGE;
  if (kind === "ALIYUN_PROVIDER_ERROR") return OCR_PROVIDER_FAILURE_MESSAGE;
  return "";
}

export function supplierDocumentOcrFailureActionMessage(error: unknown) {
  const kind = supplierDocumentOcrFailureKind(error);
  const mapped = supplierDocumentOcrFailureMessageForKind(kind);
  if (mapped) return mapped;
  return sanitizeSupplierOcrMessage(supplierOcrErrorText(error));
}

export function sanitizeSupplierOcrMessage(value: unknown, fallback = "OCR识别失败，需人工核对。") {
  const message = cleanText(value);
  if (!message) return fallback;
  if (/(ConnectTimeout|ReadTimeout|Timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|Connect HTTPS)/i.test(message)) {
    return OCR_NETWORK_FAILURE_MESSAGE;
  }
  if (/(ocrServiceNotOpen|not activated the OCR service|未开通|未启用|code[:=]?\s*401|Unauthorized|Forbidden|AccessDenied|NoPermission|InvalidAccessKeyId|SignatureDoesNotMatch)/i.test(message)) {
    return OCR_PERMISSION_FAILURE_MESSAGE;
  }
  if (/(https?:\/\/|ocr-api|accessKey|access key|secret|Keys=|request id|requestId|code[:=]\s*\d{3})/i.test(message)) {
    return OCR_PROVIDER_FAILURE_MESSAGE;
  }
  return message.slice(0, 500);
}

export function supplierDocumentOcrFailureMessage(error: unknown) {
  return supplierDocumentOcrFailureActionMessage(error);
}

export function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[（）()【】\[\]{}《》<>，,。.\s·\-_/\\:：;；"'“”‘’]/g, "");
}

export function normalizeTaxIdentifier(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function looselyMatches(left: unknown, right: unknown) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanText(match?.[1]);
    if (value) return value;
  }
  return "";
}

export function moneyValue(value: unknown) {
  const text = String(value || "")
    .replace(/[人民币¥￥,\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseAmount(text: string, patterns: RegExp[]) {
  return moneyValue(firstMatch(text, patterns));
}

export function parseDateText(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  const normalized = value
    .replace(/[年月.]/g, "-")
    .replace(/[日号]/g, "")
    .replace(/--+/g, "-")
    .trim();
  return normalized || value;
}

export function amountMatches(actual: number, expected: number) {
  if (!actual || !expected) return false;
  const diff = Math.abs(actual - expected);
  const percentTolerance = Math.abs(expected) * 0.005;
  return diff <= Math.max(1, percentTolerance);
}

export function shortRawText(text = "") {
  return text.slice(0, 120000);
}

export function visibleResultFields(fields: Record<string, unknown>, labels: Record<string, string>): FieldResult[] {
  return Object.entries(labels)
    .map(([key, label]) => ({ key, label, value: cleanText(fields[key]) }))
    .filter((field) => field.value);
}

export function structuredText(fields: Record<string, unknown> | null | undefined, key: string) {
  return cleanText(fields?.[key]);
}

export function structuredAmount(fields: Record<string, unknown> | null | undefined, key: string) {
  return moneyValue(fields?.[key]);
}

export function parseVatInvoiceFields(text: string, structuredFields: Record<string, unknown> = {}) {
  return parseVatInvoiceFieldsCore(text, structuredFields);
}

export function parseContractFields(text: string, structuredFields: Record<string, unknown> = {}) {
  const supplier = firstMatch(text, [
    /供(?:货|应)方[:：]\s*([^\n\r]+)/,
    /卖方[:：]\s*([^\n\r]+)/,
    /乙方[:：]\s*([^\n\r]+)/,
  ]);
  const buyer = firstMatch(text, [
    /采购方[:：]\s*([^\n\r]+)/,
    /买方[:：]\s*([^\n\r]+)/,
    /甲方[:：]\s*([^\n\r]+)/,
  ]);
  const orderNo = selectBestContractOrderNo(text, structuredText(structuredFields, "orderNo") || structuredText(structuredFields, "contractNo") || firstMatch(text, [
    /(?:订单号|合同号|采购单号|PO)[:：]?\s*([A-Z0-9_\-\/]{3,40})/i,
  ]));
  const contractAmount = parseAmount(text, [
    /合同金额[:：]?\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
    /总金额[:：]?\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
    /价税合计[:：]?\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/,
  ]);
  const productName = firstMatch(text, [
    /产品名称[:：]\s*([^\n\r]+)/,
    /品名[:：]\s*([^\n\r]+)/,
    /货物名称[:：]\s*([^\n\r]+)/,
  ]);
  const specModel = firstMatch(text, [
    /规格型号[:：]\s*([^\n\r]+)/,
    /规格[:：]\s*([^\n\r]+)/,
  ]);
  const quantity = firstMatch(text, [
    /数量[:：]\s*([0-9,]+(?:\.[0-9]+)?)/,
  ]);
  const unitPrice = firstMatch(text, [
    /单价[:：]\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,4})?)/,
  ]);
  const signDate = parseDateText(text, [
    /签订日期[:：]?\s*([0-9]{4}[年\-/.][0-9]{1,2}[月\-/.][0-9]{1,2}[日号]?)/,
    /签署日期[:：]?\s*([0-9]{4}[年\-/.][0-9]{1,2}[月\-/.][0-9]{1,2}[日号]?)/,
  ]);
  return {
    supplier: structuredText(structuredFields, "supplier") || supplier,
    buyer: structuredText(structuredFields, "buyer") || buyer,
    orderNo,
    contractNo: orderNo || structuredText(structuredFields, "contractNo"),
    contractAmount: structuredAmount(structuredFields, "amount") || contractAmount,
    productName: structuredText(structuredFields, "productName") || productName,
    specModel: structuredText(structuredFields, "specModel") || specModel,
    quantity: structuredText(structuredFields, "quantity") || quantity,
    unitPrice: structuredText(structuredFields, "unitPrice") || unitPrice,
    signDate: structuredText(structuredFields, "signingDate") || signDate,
  };
}

export function supplierDocumentLabels(documentType: string) {
  if (documentType === "SUPPLIER_INVOICE") {
    return {
      invoiceNo: "发票号",
      invoiceDate: "开票日期",
      amountWithTax: "含税金额",
      amountWithoutTax: "不含税金额",
      taxAmount: "税额",
      taxRate: "税率",
      seller: "销售方",
      sellerTaxNo: "销售方纳税人识别号",
      buyer: "购买方",
      buyerTaxNo: "购买方纳税人识别号",
      productName: "产品名称 / 服务名称",
      specModel: "规格型号",
      unit: "单位",
      quantity: "数量",
      unitPrice: "单价",
    };
  }
  return {
    supplier: "供应商",
    buyer: "采购方",
    orderNo: "订单号 / 合同号",
    contractAmount: "合同金额",
    productName: "产品名称",
    specModel: "规格型号",
    quantity: "数量",
    unitPrice: "单价",
    signDate: "签订日期",
  };
}
