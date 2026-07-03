import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { readR2Object } from "../r2";
import { prisma } from "../prisma";
import {
  DEFAULT_COMPANY_PROFILE_SETTINGS,
  FACTORY_SUPPLIER_COST_TYPES,
  runNonCriticalTask,
} from "./shared-constants";
import {
  codedError,
  logServerError,
  nonEmpty,
  num,
} from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import { getCompanyProfileSettings } from "./company-profile";
import { isOcrFeatureEnabled, recognizeSupplierDocumentWithOcr } from "./ocr-integration";
import { saveOcrRawResult } from "./ocr-raw-results";
import { refreshSupplierDocumentRequestCompletion, type CompletionRefreshOptions } from "./supplier-document-request-completion";
import { refreshCustomsDeclarationAfterOwnershipChange, upsertCustomsDeclarationSupplierLink } from "./customs-declaration-ownership";
import {
  contractOrderNoMatches,
  contractOrderSetKey,
  selectBestContractOrderNo,
} from "./supplier-contract-order-match";
import {
  isSuspiciousInvoiceParty as isSuspiciousInvoicePartyCore,
  isSuspiciousInvoiceProduct as isSuspiciousInvoiceProductCore,
  parseVatInvoiceFields as parseVatInvoiceFieldsCore,
} from "./supplier-vat-invoice-parser";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
} | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type OcrDocumentRow = Prisma.OrderDocumentGetPayload<{
  include: {
    order: { include: { businessEntity: true } };
    supplier: true;
    cost: true;
    factoryDocumentRequest: {
      include: {
        customsDeclaration: true;
        order: {
          include: {
            businessEntity: true;
            costs: { where: { deletedAt: null }; include: { supplier: true } };
          };
        };
        supplier: true;
      };
    };
  };
}>;
type OcrTaskRow = Prisma.OcrTaskGetPayload<{ include: { results: true } }>;

const SUPPLIER_DOCUMENT_OCR_MODULE = "SUPPLIER_DOCUMENT_RETURN";
const SUPPLIER_DOCUMENT_OCR_FEATURE = "supplierDocumentReturn";
const SUPPLIER_DOCUMENT_OCR_TYPES = ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"];
const OCR_STATUS_PROCESSING = "OCR识别中";
const OCR_STATUS_PASSED = "OCR识别成功，校验通过";
const OCR_STATUS_EXCEPTION = "OCR识别成功，存在异常";
const OCR_STATUS_FAILED = "OCR识别失败，需人工核对";
const OCR_STATUS_MANUAL = "待人工确认";
const OCR_STALE_PROCESSING_MESSAGE = "OCR识别超时，请点击重新识别或人工核对。";
const OCR_NETWORK_FAILURE_MESSAGE = "阿里云 OCR 服务连接超时，请稍后点击“重新识别”；如仍失败，请先人工核对该文件。";
const OCR_PERMISSION_FAILURE_MESSAGE = "阿里云 OCR 服务未开通或权限配置异常，请管理员检查 OCR 服务开通状态、接口权限和 AccessKey 配置。";
const OCR_PROVIDER_FAILURE_MESSAGE = "OCR服务调用失败，请稍后点击“重新识别”；如仍失败，请联系管理员查看服务器日志。";
const VALIDATION_PASSED = "PASSED";
const VALIDATION_EXCEPTION = "EXCEPTION";
const VALIDATION_FAILED = "FAILED";
const VALIDATION_MANUAL = "PENDING_MANUAL";
const VALIDATION_CONFIRMED = "MANUAL_CONFIRMED";
const VALIDATION_REJECTED = "REJECTED";
const INTERNAL_OCR_ROLES = ["管理员", "财务", "业务员", "采购"];
const DEFAULT_SUPPLIER_OCR_PROCESSING_STALE_MS = 2 * 60 * 1000;

type ValidationIssue = {
  level: "error" | "warning" | "manual";
  message: string;
  field?: string;
};
type FieldResult = {
  key: string;
  label: string;
  value: string;
};
type OcrValidationContext = {
  document: OcrDocumentRow;
  supplierName: string;
  supplierTaxNo: string;
  businessEntityName: string;
  orderNo: string;
  purchaseOrderNo: string;
  expectedAmount: number;
};

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function supplierOcrProcessingStaleMs() {
  const configured = Number.parseInt(String(process.env.SUPPLIER_DOCUMENT_OCR_STALE_MS || ""), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SUPPLIER_OCR_PROCESSING_STALE_MS;
}

function supplierOcrErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

function supplierOcrErrorCode(error: unknown) {
  return String((error as { code?: unknown } | null)?.code || "");
}

function isSupplierOcrNetworkError(error: unknown) {
  const text = [supplierOcrErrorCode(error), supplierOcrErrorText(error)].join(" ");
  return /(ConnectTimeout|ReadTimeout|Timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|Connect HTTPS)/i.test(text);
}

function sanitizeSupplierOcrMessage(value: unknown, fallback = "OCR识别失败，需人工核对。") {
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

function supplierDocumentOcrFailureMessage(error: unknown) {
  if (isSupplierOcrNetworkError(error)) {
    return OCR_NETWORK_FAILURE_MESSAGE;
  }
  return sanitizeSupplierOcrMessage(supplierOcrErrorText(error));
}

function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[（）()【】\[\]{}《》<>，,。.\s·\-_/\\:：;；"'“”‘’]/g, "");
}

function normalizeTaxIdentifier(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function looselyMatches(left: unknown, right: unknown) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanText(match?.[1]);
    if (value) return value;
  }
  return "";
}

function moneyValue(value: unknown) {
  const text = String(value || "")
    .replace(/[人民币¥￥,\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAmount(text: string, patterns: RegExp[]) {
  return moneyValue(firstMatch(text, patterns));
}

function parseDateText(text: string, patterns: RegExp[]) {
  const value = firstMatch(text, patterns);
  const normalized = value
    .replace(/[年月.]/g, "-")
    .replace(/[日号]/g, "")
    .replace(/--+/g, "-")
    .trim();
  return normalized || value;
}

function amountMatches(actual: number, expected: number) {
  if (!actual || !expected) return false;
  const diff = Math.abs(actual - expected);
  const percentTolerance = Math.abs(expected) * 0.005;
  return diff <= Math.max(1, percentTolerance);
}

function shortRawText(text = "") {
  return text.slice(0, 120000);
}

function visibleResultFields(fields: Record<string, unknown>, labels: Record<string, string>): FieldResult[] {
  return Object.entries(labels)
    .map(([key, label]) => ({ key, label, value: cleanText(fields[key]) }))
    .filter((field) => field.value);
}

function structuredText(fields: Record<string, unknown> | null | undefined, key: string) {
  return cleanText(fields?.[key]);
}

function structuredAmount(fields: Record<string, unknown> | null | undefined, key: string) {
  return moneyValue(fields?.[key]);
}

export function parseVatInvoiceFields(text: string, structuredFields: Record<string, unknown> = {}) {
  return parseVatInvoiceFieldsCore(text, structuredFields);
}

function parseContractFields(text: string, structuredFields: Record<string, unknown> = {}) {
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

function supplierDocumentLabels(documentType: string) {
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

function expectedAmountFromDocument(document: OcrDocumentRow) {
  const requestAmount = num(document.factoryDocumentRequest?.requiredInvoiceAmount, 0);
  if (requestAmount > 0) return requestAmount;
  if (document.cost) {
    const currency = String(document.cost.currency || "CNY").toUpperCase();
    const amount = currency === "CNY" ? num(document.cost.amount, 0) : num(document.cost.amountCny, 0);
    if (amount > 0) return amount;
  }
  const request = document.factoryDocumentRequest;
  const costs = request?.order?.costs || [];
  return costs
    .filter((cost) => cost.orderId === document.orderId
      && cost.supplierId === document.supplierId
      && FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType)
      && cost.deletedAt == null)
    .reduce((sum, cost) => sum + num(cost.currency === "CNY" ? cost.amount : cost.amountCny, 0), 0);
}

async function ocrValidationContext(document: OcrDocumentRow): Promise<OcrValidationContext> {
  const profile = await runNonCriticalTask("OCR校验公司资料读取", () => getCompanyProfileSettings(), { track: false });
  const supplierName = document.supplier?.supplierName || document.factoryDocumentRequest?.supplier?.supplierName || "";
  const supplierTaxNo = document.supplier?.taxNumber || document.factoryDocumentRequest?.supplier?.taxNumber || "";
  const businessEntityName = document.order.businessEntity?.name
    || document.order.businessEntityNameSnapshot
    || document.factoryDocumentRequest?.order?.businessEntity?.name
    || document.factoryDocumentRequest?.order?.businessEntityNameSnapshot
    || profile?.companyNameZh
    || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh;
  const orderNo = document.order.orderNo || document.factoryDocumentRequest?.order?.orderNo || "";
  return {
    document,
    supplierName,
    supplierTaxNo,
    businessEntityName,
    orderNo,
    purchaseOrderNo: orderNo,
    expectedAmount: expectedAmountFromDocument(document),
  };
}

function enrichVatInvoiceFields(
  fields: ReturnType<typeof parseVatInvoiceFields>,
  context: OcrValidationContext,
  rawText: string,
) {
  const enriched = { ...fields };
  if (!enriched.seller && context.supplierName) {
    const recognizedSellerTaxNo = normalizeTaxIdentifier(enriched.sellerTaxNo);
    const expectedSupplierTaxNo = normalizeTaxIdentifier(context.supplierTaxNo);
    if (recognizedSellerTaxNo && expectedSupplierTaxNo && recognizedSellerTaxNo === expectedSupplierTaxNo) {
      enriched.seller = context.supplierName;
    } else if (rawText && looselyMatches(rawText, context.supplierName)) {
      enriched.seller = context.supplierName;
    }
  }
  if (!enriched.buyer && context.businessEntityName && rawText && looselyMatches(rawText, context.businessEntityName)) {
    enriched.buyer = context.businessEntityName;
  }
  return enriched;
}

async function validateInvoice(fields: ReturnType<typeof parseVatInvoiceFields>, context: OcrValidationContext, documentId: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!fields.seller) {
    issues.push({ level: "manual", field: "seller", message: "未识别到发票销售方，需人工确认" });
  } else if (!looselyMatches(fields.seller, context.supplierName)) {
    issues.push({ level: "error", field: "seller", message: "发票销售方与供应商不一致" });
  }
  if (!fields.buyer) {
    issues.push({ level: "manual", field: "buyer", message: "未识别到发票购买方，需人工确认" });
  } else if (!looselyMatches(fields.buyer, context.businessEntityName)) {
    issues.push({ level: "error", field: "buyer", message: "发票购买方与业务主体不一致" });
  }
  if (!fields.amountWithTax) {
    issues.push({ level: "manual", field: "amountWithTax", message: "未识别到发票含税金额，需人工确认" });
  } else if (context.expectedAmount > 0 && !amountMatches(fields.amountWithTax, context.expectedAmount)) {
    issues.push({ level: "error", field: "amountWithTax", message: "发票金额与采购订单金额不一致" });
  } else if (!context.expectedAmount) {
    issues.push({ level: "manual", field: "amountWithTax", message: "系统未找到可比对的采购订单金额，需人工确认" });
  }
  if (!fields.taxRate) {
    issues.push({ level: "manual", field: "taxRate", message: "未识别到税率，需人工确认" });
  } else if (!/^13(?:\.0+)?%$/.test(String(fields.taxRate).trim())) {
    issues.push({ level: "warning", field: "taxRate", message: "发票税率不是 13%，请人工确认" });
  }
  if (!fields.invoiceNo) {
    issues.push({ level: "manual", field: "invoiceNo", message: "未识别到发票号码，需人工确认" });
  } else {
    const duplicated = await prisma.ocrResult.findFirst({
      where: {
        fieldKey: "invoiceNo",
        value: fields.invoiceNo,
        task: {
          documentId: { not: documentId },
          documentType: "SUPPLIER_INVOICE",
        },
      },
      select: { id: true, task: { select: { documentId: true, orderId: true } } },
    });
    if (duplicated) {
      issues.push({ level: "error", field: "invoiceNo", message: "发票号码已存在，请核查" });
    }
  }
  return issues;
}

function invoiceParserIssues(fields: ReturnType<typeof parseVatInvoiceFields>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (isSuspiciousInvoicePartyCore(fields.buyer)) {
    issues.push({ level: "error", field: "buyer", message: "发票购买方解析异常，请人工确认" });
  }
  if (isSuspiciousInvoicePartyCore(fields.seller)) {
    issues.push({ level: "error", field: "seller", message: "发票销售方解析异常，请人工确认" });
  }
  if (isSuspiciousInvoiceProductCore(fields.productName)) {
    issues.push({ level: "error", field: "productName", message: "发票产品名称解析异常，请人工确认" });
  }
  return issues;
}

function validateContract(fields: ReturnType<typeof parseContractFields>, context: OcrValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!fields.supplier) {
    issues.push({ level: "manual", field: "supplier", message: "未识别到合同供应商，需人工确认" });
  } else if (!looselyMatches(fields.supplier, context.supplierName)) {
    issues.push({ level: "error", field: "supplier", message: "合同供应商与当前供应商不一致" });
  }
  if (!fields.buyer) {
    issues.push({ level: "manual", field: "buyer", message: "未识别到合同采购方，需人工确认" });
  } else if (!looselyMatches(fields.buyer, context.businessEntityName)) {
    issues.push({ level: "error", field: "buyer", message: "合同采购方与业务主体不一致" });
  }
  if (!fields.orderNo) {
    issues.push({ level: "manual", field: "orderNo", message: "未识别到合同订单号，需人工确认" });
  } else {
    const matched = contractOrderNoMatches(fields.orderNo, context.purchaseOrderNo);
    console.info("supplier-contract-order-compare", {
      systemOrderNo: context.purchaseOrderNo,
      ocrOrderNo: fields.orderNo,
      normalizedSystemOrderNo: contractOrderSetKey(context.purchaseOrderNo),
      normalizedOcrOrderNo: contractOrderSetKey(fields.orderNo),
      matched,
    });
    if (!matched) {
    issues.push({ level: "error", field: "orderNo", message: "合同订单号与采购订单号不一致" });
    }
  }
  if (!fields.contractAmount) {
    issues.push({ level: "manual", field: "contractAmount", message: "未识别到合同金额，需人工确认" });
  } else if (context.expectedAmount > 0 && !amountMatches(fields.contractAmount, context.expectedAmount)) {
    issues.push({ level: "error", field: "contractAmount", message: "合同金额与采购订单金额不一致" });
  } else if (!context.expectedAmount) {
    issues.push({ level: "manual", field: "contractAmount", message: "系统未找到可比对的采购订单金额，需人工确认" });
  }
  if (!fields.productName || !fields.specModel || !fields.quantity) {
    issues.push({ level: "manual", field: "productDetail", message: "产品名称、规格或数量无法准确判断，需人工确认" });
  }
  return issues;
}

function taskStatusFromIssues(issues: ValidationIssue[]) {
  if (issues.some((issue) => issue.level === "error")) {
    return { status: OCR_STATUS_EXCEPTION, validationStatus: VALIDATION_EXCEPTION };
  }
  if (issues.some((issue) => issue.level === "warning" || issue.level === "manual")) {
    return { status: OCR_STATUS_MANUAL, validationStatus: VALIDATION_MANUAL };
  }
  return { status: OCR_STATUS_PASSED, validationStatus: VALIDATION_PASSED };
}

export async function reconcileStaleSupplierDocumentOcrTasks(documentIds: string[] = []) {
  const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))];
  if (!uniqueDocumentIds.length) return 0;
  const staleBefore = new Date(Date.now() - supplierOcrProcessingStaleMs());
  try {
    const staleTasks = await prisma.ocrTask.findMany({
      where: {
        module: SUPPLIER_DOCUMENT_OCR_MODULE,
        documentId: { in: uniqueDocumentIds },
        OR: [
          { status: OCR_STATUS_PROCESSING },
          { validationStatus: "PROCESSING" },
        ],
        updatedAt: { lt: staleBefore },
      },
      select: { id: true, documentId: true, requestId: true, updatedAt: true },
      take: Math.min(Math.max(uniqueDocumentIds.length * 2, 20), 500),
    });
    if (!staleTasks.length) return 0;
    const ids = staleTasks.map((task) => task.id);
    const staleDocuments = await prisma.orderDocument.findMany({
      where: { id: { in: staleTasks.map((task) => task.documentId) }, deletedAt: null },
      select: {
        id: true,
        documentType: true,
        supplierId: true,
        costId: true,
        factoryDocumentRequestId: true,
        factoryDocumentRequest: {
          select: {
            id: true,
            customsDeclarationId: true,
            costId: true,
          },
        },
      },
      take: Math.min(staleTasks.length, 500),
    });
    await prisma.ocrTask.updateMany({
      where: { id: { in: ids } },
      data: {
        status: OCR_STATUS_FAILED,
        validationStatus: VALIDATION_FAILED,
        errorMessage: OCR_STALE_PROCESSING_MESSAGE,
        validationJson: {
          issues: [{ level: "manual", message: OCR_STALE_PROCESSING_MESSAGE }],
          parserStatus: "OCR后台任务超时",
        },
      },
    });
    const requestIds = [...new Set(staleTasks.map((task) => task.requestId).filter((requestId): requestId is string => Boolean(requestId)))];
    for (const requestId of requestIds) {
      await refreshSupplierDocumentRequestQualification(requestId);
    }
    const customsDeclarationIds = new Set<string>();
    for (const document of staleDocuments) {
      const customsDeclarationId = document.factoryDocumentRequest?.customsDeclarationId || "";
      if (!customsDeclarationId || !document.supplierId) continue;
      const isContract = document.documentType === "SUPPLIER_PURCHASE_CONTRACT";
      await prisma.customsDeclarationSupplier.updateMany({
        where: {
          customsDeclarationId,
          supplierId: document.supplierId,
          purchaseOrderId: document.costId || document.factoryDocumentRequest?.costId || null,
          deletedAt: null,
        },
        data: {
          validationStatus: "PENDING",
          validationMessage: OCR_STALE_PROCESSING_MESSAGE,
          manualApprovedByUserId: null,
          manualApprovedAt: null,
          manualApprovalReason: null,
          ...(isContract ? { contractAmount: null } : { vatInvoiceAmount: null }),
        },
      });
      customsDeclarationIds.add(customsDeclarationId);
    }
    for (const customsDeclarationId of customsDeclarationIds) {
      await refreshCustomsDeclarationAfterOwnershipChange(customsDeclarationId, "供应商OCR超时后报关批次完整度刷新");
    }
    console.warn("supplier-document-ocr-stale-processing-reconciled", {
      count: staleTasks.length,
      documentIds: staleTasks.map((task) => task.documentId),
      requestIds: staleTasks.map((task) => task.requestId).filter(Boolean),
      staleBefore: staleBefore.toISOString(),
    });
    return staleTasks.length;
  } catch (error) {
    throwIfSupplierOcrTableMissing(error);
    logServerError("供应商资料回传OCR处理中任务自愈失败", error, { documentCount: uniqueDocumentIds.length });
    return 0;
  }
}

function assertInternalOcrManager(actor: ActorLike) {
  if (!actor?.id || !INTERNAL_OCR_ROLES.includes(String(actor.role || ""))) {
    throw codedError("没有权限处理 OCR 校验结果。", 403, "OCR_MANAGE_PERMISSION_DENIED");
  }
}

function normalizeSupplierReturnDocumentType(value: unknown) {
  const type = String(value || "").trim().toUpperCase();
  if (["SUPPLIER_PURCHASE_CONTRACT", "PURCHASE_CONTRACT", "FACTORY_PURCHASE_CONTRACT", "FACTORY_CONTRACT"].includes(type)) {
    return "SUPPLIER_PURCHASE_CONTRACT";
  }
  if (["SUPPLIER_INVOICE", "VAT_INVOICE", "SUPPLIER_VAT_INVOICE", "FACTORY_INVOICE", "FACTORY_VAT_INVOICE"].includes(type)) {
    return "SUPPLIER_INVOICE";
  }
  return type;
}

function isSupplierOcrTableMissingError(error: unknown) {
  const typedError = (error || {}) as { code?: string; meta?: { table?: unknown; modelName?: unknown }; message?: string };
  const haystack = [
    typedError.code,
    typedError.meta?.table,
    typedError.meta?.modelName,
    typedError.message,
  ].map((value) => String(value || "")).join(" ");
  return typedError.code === "P2021" && /ocr_tasks|ocr_results|OcrTask|OcrResult/i.test(haystack);
}

function supplierOcrTableName(error: unknown) {
  const typedError = (error || {}) as { meta?: { table?: unknown; modelName?: unknown }; message?: string };
  const explicit = String(typedError.meta?.table || typedError.meta?.modelName || "").trim();
  if (explicit) return explicit;
  const match = String(typedError.message || "").match(/ocr_(?:tasks|results)|OcrTask|OcrResult/i);
  return match?.[0] || "";
}

function throwIfSupplierOcrTableMissing(error: unknown): never | void {
  if (!isSupplierOcrTableMissingError(error)) return;
  const table = supplierOcrTableName(error);
  throw codedError(
    `OCR 数据表未初始化，请联系管理员执行数据库迁移${table ? `（缺少 ${table}）` : ""}。`,
    503,
    "OCR_TABLE_NOT_INITIALIZED",
  );
}

async function loadSupplierReturnDocument(documentId: string, requestId = ""): Promise<OcrDocumentRow> {
  if (!documentId) throw codedError("缺少 supplierReturnDocumentId。", 400, "SUPPLIER_RETURN_DOCUMENT_ID_REQUIRED");
  const document = await prisma.orderDocument.findFirst({
    where: {
      id: documentId,
      deletedAt: null,
      relatedModule: "SUPPLIER",
      documentType: { in: SUPPLIER_DOCUMENT_OCR_TYPES as OrderDocumentType[] },
      ...(requestId ? { factoryDocumentRequestId: requestId } : {}),
    },
    include: {
      order: { include: { businessEntity: true } },
      supplier: true,
      cost: true,
      factoryDocumentRequest: {
        include: {
          customsDeclaration: true,
          order: {
            include: {
              businessEntity: true,
              costs: { where: { deletedAt: null }, include: { supplier: true } },
            },
          },
          supplier: true,
        },
      },
    },
  });
  if (!document) {
    throw codedError("回传资料文件不存在或无权限访问。", 404, "SUPPLIER_DOCUMENT_NOT_FOUND");
  }
  if (requestId && document.factoryDocumentRequestId !== requestId) {
    throw codedError("回传资料文件与当前任务不匹配。", 400, "SUPPLIER_DOCUMENT_REQUEST_MISMATCH");
  }
  if (!document.storageKey) {
    throw codedError("文件记录存在，但文件地址无法访问。", 404, "SUPPLIER_DOCUMENT_FILE_MISSING");
  }
  if (document.uploadStatus && document.uploadStatus !== "SUCCESS") {
    throw codedError("文件尚未上传完成，不能进行 OCR 识别。", 400, "SUPPLIER_DOCUMENT_UPLOAD_INCOMPLETE");
  }
  return document;
}

async function createSupplierDocumentOcrTask(document: OcrDocumentRow) {
  if (!(await isOcrFeatureEnabled(SUPPLIER_DOCUMENT_OCR_FEATURE))) return null;
  try {
    const task = await prisma.ocrTask.create({
      data: {
        module: SUPPLIER_DOCUMENT_OCR_MODULE,
        documentId: document.id,
        requestId: document.factoryDocumentRequestId,
        orderId: document.orderId,
        supplierId: document.supplierId,
        documentType: document.documentType,
        status: OCR_STATUS_PROCESSING,
        validationStatus: "PROCESSING",
      },
      include: { results: true },
    });
    if (document.factoryDocumentRequestId) {
      await refreshSupplierDocumentRequestQualification(document.factoryDocumentRequestId);
    }
    return task;
  } catch (error: unknown) {
    throwIfSupplierOcrTableMissing(error);
    throw error;
  }
}

export async function createSupplierDocumentOcrTaskForUpload(documentId: string) {
  const document = await loadSupplierReturnDocument(documentId);
  return createSupplierDocumentOcrTask(document);
}

export async function runSupplierDocumentOcrTask(taskId: string) {
  try {
    const task = await prisma.ocrTask.findUnique({ where: { id: taskId } });
    if (!task) throw codedError("OCR任务不存在。", 404, "OCR_TASK_NOT_FOUND");
    return runSupplierDocumentOcrForDocument(task.documentId, null, { taskId, requestId: task.requestId || "" });
  } catch (error: unknown) {
    throwIfSupplierOcrTableMissing(error);
    throw error;
  }
}

export async function runSupplierDocumentOcrForDocument(
  documentId: string,
  actor: ActorLike = null,
  options: { taskId?: string; requestId?: string } = {},
) {
  if (actor) {
    assertRead(actor, "supplierDocuments");
    assertInternalOcrManager(actor);
  }
  const document = await loadSupplierReturnDocument(documentId, options.requestId || "");
  let task: OcrTaskRow | null = null;
  try {
    task = options.taskId
      ? await prisma.ocrTask.update({
          where: { id: options.taskId },
          data: { status: OCR_STATUS_PROCESSING, validationStatus: "PROCESSING", errorMessage: null },
          include: { results: true },
        })
      : await createSupplierDocumentOcrTaskForUpload(document.id);
  } catch (error: unknown) {
    throwIfSupplierOcrTableMissing(error);
    throw error;
  }
  if (!task) return null;
  let latestRawText = "";
  let latestRawJson: unknown = null;
  let latestApiName = "";
  let latestProvider = "ALIYUN";
  try {
    const fileBuffer = await readR2Object(document.storageKey);
    const recognized = await recognizeSupplierDocumentWithOcr(
      fileBuffer,
      document.documentType as "SUPPLIER_PURCHASE_CONTRACT" | "SUPPLIER_INVOICE",
      { requireText: false },
    );
    const text = cleanText(recognized.text);
    const structuredFields = recognized.extractedFields || {};
    latestRawJson = recognized.rawJson || { source: recognized.source, provider: recognized.provider, textLength: text.length };
    latestApiName = recognized.apiName || recognized.source || "";
    latestProvider = recognized.provider || "ALIYUN";
    latestRawText = text;
    const hasStructuredFields = Object.values(structuredFields).some((value) => cleanText(value));
    if (!text && !hasStructuredFields) throw codedError("OCR原文未识别，请人工核对。", 422, "SUPPLIER_DOCUMENT_OCR_NO_TEXT");
    const context = await ocrValidationContext(document);
    const fields = document.documentType === "SUPPLIER_INVOICE"
      ? enrichVatInvoiceFields(parseVatInvoiceFields(text, structuredFields), context, text)
      : parseContractFields(text, structuredFields);
    const labels = supplierDocumentLabels(document.documentType) as unknown as Record<string, string>;
    const parserIssues = document.documentType === "SUPPLIER_INVOICE"
      ? invoiceParserIssues(fields as ReturnType<typeof parseVatInvoiceFields>)
      : [];
    const issues = parserIssues.length
      ? parserIssues
      : document.documentType === "SUPPLIER_INVOICE"
        ? await validateInvoice(fields as ReturnType<typeof parseVatInvoiceFields>, context, document.id)
        : validateContract(fields as ReturnType<typeof parseContractFields>, context);
    const status = taskStatusFromIssues(issues);
    const fieldRows = visibleResultFields(fields as Record<string, unknown>, labels);
    if (!fieldRows.length) {
      throw codedError("OCR原文已识别但解析失败，请人工核对。", 422, "SUPPLIER_DOCUMENT_PARSE_FAILED");
    }
    console.info("supplier-document-ocr-parse", {
      documentId,
      taskId: task.id,
      documentType: document.documentType,
      rawText: shortRawText(text).slice(0, 4000),
      rawJson: recognized.rawJson || { source: recognized.source, provider: recognized.provider, textLength: text.length },
      parser: recognized.parser || (document.documentType === "SUPPLIER_INVOICE" ? "VAT_INVOICE" : "PURCHASE_CONTRACT"),
      extractedFields: fields,
      validationResult: { status, issues },
    });
    const saved = await prisma.$transaction(async (tx) => {
      await saveOcrRawResult({
        documentId: document.id,
        orderId: document.orderId,
        documentType: document.documentType,
        provider: latestProvider,
        apiName: latestApiName || (document.documentType === "SUPPLIER_INVOICE" ? "ALIYUN_RECOGNIZE_INVOICE" : "ALIYUN_RECOGNIZE_GENERAL_STRUCTURE"),
        rawJson: latestRawJson,
        parsedJson: {
          fields,
          structuredFields,
          validation: { status: status.validationStatus, issues },
          parser: recognized.parser || (document.documentType === "SUPPLIER_INVOICE" ? "VAT_INVOICE" : "PURCHASE_CONTRACT"),
        },
        confidence: recognized.confidence ?? null,
        status: status.validationStatus === VALIDATION_PASSED ? "SUCCESS" : "EXCEPTION",
        errorMessage: issues.map((issue) => issue.message).join("；"),
      }, tx);
      await tx.ocrResult.deleteMany({ where: { taskId: task.id } });
      if (fieldRows.length) {
        await tx.ocrResult.createMany({
          data: fieldRows.map((field) => ({
            taskId: task.id,
            fieldKey: field.key,
            label: field.label,
            value: field.value,
            rawValue: field.value,
          })),
        });
      }
      return tx.ocrTask.update({
        where: { id: task.id },
        data: {
          status: status.status,
          validationStatus: status.validationStatus,
          errorMessage: null,
          rawText: shortRawText(text),
          resultJson: fields as Prisma.InputJsonValue,
          validationJson: {
            issues,
            expectedAmount: context.expectedAmount,
            supplierName: context.supplierName,
            supplierTaxNo: context.supplierTaxNo,
            businessEntityName: context.businessEntityName,
            orderNo: context.orderNo,
            source: recognized.source,
            provider: recognized.provider,
            rawJson: (recognized.rawJson || { source: recognized.source, provider: recognized.provider, textLength: text.length }) as Prisma.InputJsonValue,
            parser: recognized.parser || (document.documentType === "SUPPLIER_INVOICE" ? "VAT_INVOICE" : "PURCHASE_CONTRACT"),
            structuredFields: structuredFields as Prisma.InputJsonValue,
            extractedFields: fields as Prisma.InputJsonValue,
          },
        },
        include: { results: true },
      });
    });
    const completion = document.factoryDocumentRequestId
      ? await refreshSupplierDocumentRequestQualification(document.factoryDocumentRequestId)
      : null;
    if (document.factoryDocumentRequest?.customsDeclarationId && document.supplierId) {
      const documentAmount = document.documentType === "SUPPLIER_INVOICE"
        ? ("amountWithTax" in fields ? fields.amountWithTax : null)
        : ("contractAmount" in fields ? fields.contractAmount : null);
      const forcePendingReason = completion?.status === "已完成" && status.validationStatus === VALIDATION_PASSED
        ? ""
        : issues.map((issue) => issue.message).filter(Boolean).join("；").slice(0, 500)
          || (completion?.status === "已完成" ? "供应商资料OCR校验未通过" : "仍有供应商资料未完成校验");
      await prisma.$transaction(async (tx) => {
        await upsertCustomsDeclarationSupplierLink(tx, {
          customsDeclarationId: document.factoryDocumentRequest?.customsDeclarationId || "",
          supplierId: document.supplierId || "",
          purchaseOrderId: document.costId || document.factoryDocumentRequest?.costId || null,
          requiredInvoiceAmount: document.factoryDocumentRequest?.requiredInvoiceAmount || null,
          documentType: document.documentType,
          documentId: document.id,
          documentAmount,
          forcePendingReason,
        });
      });
      if (completion?.status === "已完成") {
        await markBatchSupplierManualApprovedIfRequestCompleted({
          requestId: document.factoryDocumentRequestId || "",
          customsDeclarationId: document.factoryDocumentRequest.customsDeclarationId,
          supplierId: document.supplierId,
          purchaseOrderId: document.costId || document.factoryDocumentRequest.costId || null,
          actorId: document.uploadedById || null,
        });
      }
      await refreshCustomsDeclarationAfterOwnershipChange(document.factoryDocumentRequest.customsDeclarationId, "供应商OCR后报关批次完整度刷新");
    }
    return saved;
  } catch (error) {
    throwIfSupplierOcrTableMissing(error);
    const originalMessage = supplierOcrErrorText(error);
    const message = supplierDocumentOcrFailureMessage(error);
    let saved: OcrTaskRow;
    try {
      saved = await prisma.ocrTask.update({
        where: { id: task.id },
        data: {
          status: OCR_STATUS_FAILED,
          validationStatus: VALIDATION_FAILED,
          errorMessage: message.slice(0, 1000),
          rawText: latestRawText ? shortRawText(latestRawText) : null,
          validationJson: {
            issues: [{ level: "manual", message }],
            parserStatus: latestRawText ? "OCR原文已识别但解析失败" : "OCR原文未识别",
            technicalError: originalMessage.slice(0, 1000),
            provider: latestProvider,
            apiName: latestApiName || "SUPPLIER_DOCUMENT_OCR",
          },
        },
        include: { results: true },
      });
      await saveOcrRawResult({
        documentId: document.id,
        orderId: document.orderId,
        documentType: document.documentType,
        provider: latestProvider,
        apiName: latestApiName || "SUPPLIER_DOCUMENT_OCR",
        rawJson: latestRawJson || (latestRawText ? { text: latestRawText } : null),
        parsedJson: latestRawText ? { rawText: latestRawText } : null,
        status: "FAILED",
        errorMessage: [message, originalMessage && originalMessage !== message ? `technical: ${originalMessage}` : ""].filter(Boolean).join("；").slice(0, 1000),
      }).catch(() => null);
    } catch (updateError: unknown) {
      throwIfSupplierOcrTableMissing(updateError);
      throw updateError;
    }
    logServerError("产品供应商回传资料OCR识别失败", error, { documentId, taskId: task.id });
    if (document.factoryDocumentRequestId) {
      await refreshSupplierDocumentRequestQualification(document.factoryDocumentRequestId);
    }
    if (document.factoryDocumentRequest?.customsDeclarationId && document.supplierId) {
      const isContract = document.documentType === "SUPPLIER_PURCHASE_CONTRACT";
      await prisma.customsDeclarationSupplier.updateMany({
        where: {
          customsDeclarationId: document.factoryDocumentRequest.customsDeclarationId,
          supplierId: document.supplierId,
          purchaseOrderId: document.costId || document.factoryDocumentRequest.costId || null,
          deletedAt: null,
        },
        data: {
          validationStatus: "PENDING",
          validationMessage: message.slice(0, 500),
          manualApprovedByUserId: null,
          manualApprovedAt: null,
          manualApprovalReason: null,
          ...(isContract ? { contractAmount: null } : { vatInvoiceAmount: null }),
        },
      });
      await refreshCustomsDeclarationAfterOwnershipChange(document.factoryDocumentRequest.customsDeclarationId, "供应商OCR失败后报关批次完整度刷新");
    }
    return saved;
  }
}

export async function refreshSupplierDocumentRequestQualification(requestId: string, options: CompletionRefreshOptions = {}) {
  try {
    return await refreshSupplierDocumentRequestCompletion(requestId, options);
  } catch (error: unknown) {
    throwIfSupplierOcrTableMissing(error);
    throw error;
  }
}

export async function rerunSupplierDocumentOcr(request: AuditRequestLike, actor: ActorLike, requestId: string, documentId: string) {
  assertWrite(actor, "supplierDocuments");
  assertInternalOcrManager(actor);
  try {
    const document = await loadSupplierReturnDocument(documentId, requestId);
    const before = await prisma.ocrTask.findFirst({
      where: { documentId, requestId },
      orderBy: [{ createdAt: "desc" }],
    });
    const task = await createSupplierDocumentOcrTask(document);
    if (!task) throw codedError("产品供应商资料回传 OCR 未启用，请到系统设置开启。", 403, "OCR_FEATURE_DISABLED");
    const result = await runSupplierDocumentOcrTask(task.id);
    await runNonCriticalTask("资料回传OCR重新识别日志写入", () => writeAudit(request, actor, "重新识别供应商回传资料", "ocr_tasks", task.id, before, result));
    return serializeSupplierDocumentOcrTask(result);
  } catch (error: unknown) {
    throwIfSupplierOcrTableMissing(error);
    throw error;
  }
}

async function supplierDocumentRequestHasManualConfirmedOcr(requestId: string) {
  const row = await prisma.supplierDocumentRequest.findUnique({
    where: { id: requestId },
    select: {
      documents: {
        where: { deletedAt: null },
        select: {
          ocrTasks: {
            orderBy: [{ createdAt: "desc" }],
            take: 1,
            select: { validationStatus: true },
          },
        },
      },
    },
  });
  return Boolean(row?.documents?.some((document) => document.ocrTasks?.[0]?.validationStatus === VALIDATION_CONFIRMED));
}

async function markBatchSupplierManualApprovedIfRequestCompleted(input: {
  requestId: string;
  customsDeclarationId?: string | null;
  supplierId?: string | null;
  purchaseOrderId?: string | null;
  actorId?: string | null;
  reason?: string | null;
}) {
  if (!input.requestId || !input.customsDeclarationId || !input.supplierId) return;
  const hasManualConfirmation = await supplierDocumentRequestHasManualConfirmedOcr(input.requestId);
  if (!hasManualConfirmation) return;
  const reason = nonEmpty(input.reason).slice(0, 500) || "人工核对后确认通过";
  await prisma.customsDeclarationSupplier.updateMany({
    where: {
      customsDeclarationId: input.customsDeclarationId,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId || null,
      deletedAt: null,
    },
    data: {
      validationStatus: "MANUAL_APPROVED",
      validationMessage: null,
      manualApprovedByUserId: input.actorId || null,
      manualApprovedAt: new Date(),
      manualApprovalReason: reason,
    },
  });
}

export async function confirmSupplierDocumentOcr(request: AuditRequestLike, actor: ActorLike, requestId: string, documentId: string, input: unknown = {}) {
  assertWrite(actor, "supplierDocuments");
  assertInternalOcrManager(actor);
  const reason = nonEmpty((input as { reason?: unknown; manualApprovalReason?: unknown } | null)?.reason
    || (input as { manualApprovalReason?: unknown } | null)?.manualApprovalReason)
    .slice(0, 500) || "人工核对后确认通过";
  const before = await prisma.ocrTask.findFirst({
    where: { documentId, requestId },
    orderBy: [{ createdAt: "desc" }],
    include: { results: true },
  });
  if (!before) throw codedError("没有可确认的 OCR 结果。", 404, "OCR_TASK_NOT_FOUND");
  const saved = await prisma.ocrTask.update({
    where: { id: before.id },
    data: {
      status: OCR_STATUS_PASSED,
      validationStatus: VALIDATION_CONFIRMED,
      confirmedById: actor?.id || null,
      confirmedAt: new Date(),
      rejectedById: null,
      rejectedAt: null,
      rejectReason: null,
    },
    include: { results: true },
  });
  const completion = await refreshSupplierDocumentRequestQualification(requestId, { completedById: actor?.id || null });
  const document = await prisma.orderDocument.findFirst({
    where: { id: documentId, factoryDocumentRequestId: requestId, deletedAt: null },
    select: {
      supplierId: true,
      costId: true,
      factoryDocumentRequest: { select: { customsDeclarationId: true, supplierId: true, costId: true } },
    },
  }).catch(() => null);
  if (document?.factoryDocumentRequest?.customsDeclarationId) {
    await prisma.customsDeclarationSupplier.updateMany({
      where: {
        customsDeclarationId: document.factoryDocumentRequest.customsDeclarationId,
        supplierId: document.supplierId || document.factoryDocumentRequest.supplierId,
        purchaseOrderId: document.costId || document.factoryDocumentRequest.costId || null,
        deletedAt: null,
      },
      data: completion?.status === "已完成"
        ? {
            validationStatus: "MANUAL_APPROVED",
            validationMessage: null,
            manualApprovedByUserId: actor?.id || null,
            manualApprovedAt: new Date(),
            manualApprovalReason: reason,
          }
        : {
            validationStatus: "PENDING",
            validationMessage: "仍有供应商资料未完成校验",
            manualApprovedByUserId: null,
            manualApprovedAt: null,
            manualApprovalReason: null,
          },
    });
  }
  await refreshCustomsDeclarationAfterOwnershipChange(document?.factoryDocumentRequest?.customsDeclarationId, "供应商OCR人工确认后报关批次完整度刷新");
  await runNonCriticalTask("资料回传OCR人工确认日志写入", () => writeAudit(request, actor, "人工确认供应商回传资料OCR", "ocr_tasks", saved.id, before, {
    ...saved,
    manualApprovalReason: reason,
  }));
  return serializeSupplierDocumentOcrTask(saved);
}

export async function rejectSupplierDocumentOcr(request: AuditRequestLike, actor: ActorLike, requestId: string, documentId: string, input: unknown = {}) {
  assertWrite(actor, "supplierDocuments");
  assertInternalOcrManager(actor);
  const reason = nonEmpty((input as { reason?: unknown } | null)?.reason).slice(0, 500);
  if (!reason) throw codedError("请填写驳回原因。", 400, "OCR_REJECT_REASON_REQUIRED");
  const before = await prisma.ocrTask.findFirst({
    where: { documentId, requestId },
    orderBy: [{ createdAt: "desc" }],
    include: { results: true },
  });
  if (!before) throw codedError("没有可驳回的 OCR 结果。", 404, "OCR_TASK_NOT_FOUND");
  const saved = await prisma.ocrTask.update({
    where: { id: before.id },
    data: {
      status: OCR_STATUS_MANUAL,
      validationStatus: VALIDATION_REJECTED,
      rejectedById: actor?.id || null,
      rejectedAt: new Date(),
      rejectReason: reason,
      validationJson: {
        ...(before.validationJson && typeof before.validationJson === "object" && !Array.isArray(before.validationJson) ? before.validationJson : {}),
        issues: [{ level: "error", message: reason }],
      },
    },
    include: { results: true },
  });
  await refreshSupplierDocumentRequestQualification(requestId);
  const document = await prisma.orderDocument.findFirst({
    where: { id: documentId, factoryDocumentRequestId: requestId, deletedAt: null },
    select: {
      supplierId: true,
      costId: true,
      documentType: true,
      factoryDocumentRequest: { select: { customsDeclarationId: true, supplierId: true, costId: true } },
    },
  }).catch(() => null);
  if (document?.factoryDocumentRequest?.customsDeclarationId) {
    const isContract = document.documentType === "SUPPLIER_PURCHASE_CONTRACT";
    await prisma.customsDeclarationSupplier.updateMany({
      where: {
        customsDeclarationId: document.factoryDocumentRequest.customsDeclarationId,
        supplierId: document.supplierId || document.factoryDocumentRequest.supplierId,
        purchaseOrderId: document.costId || document.factoryDocumentRequest.costId || null,
        deletedAt: null,
      },
      data: {
        validationStatus: "PENDING",
        validationMessage: reason,
        manualApprovedByUserId: null,
        manualApprovedAt: null,
        manualApprovalReason: null,
        ...(isContract ? { contractAmount: null } : { vatInvoiceAmount: null }),
      },
    });
    await refreshCustomsDeclarationAfterOwnershipChange(document.factoryDocumentRequest.customsDeclarationId, "供应商OCR驳回后报关批次完整度刷新");
  }
  await runNonCriticalTask("资料回传OCR驳回日志写入", () => writeAudit(request, actor, "驳回供应商回传资料OCR", "ocr_tasks", saved.id, before, saved));
  return serializeSupplierDocumentOcrTask(saved);
}

export function serializeSupplierDocumentOcrTask(task: OcrTaskRow | null | undefined) {
  if (!task) return null;
  const validationJson = task.validationJson && typeof task.validationJson === "object" && !Array.isArray(task.validationJson)
    ? task.validationJson as Record<string, unknown>
    : {};
  const persistedIssues = Array.isArray(validationJson.issues)
    ? validationJson.issues.map((issue) => {
        const record = issue && typeof issue === "object" ? issue as Record<string, unknown> : {};
        return {
          level: String(record.level || "manual"),
          message: sanitizeSupplierOcrMessage(record.message, ""),
          field: String(record.field || ""),
        };
      }).filter((issue) => issue.message)
    : [];
  const errorMessage = sanitizeSupplierOcrMessage(task.errorMessage, "");
  const issues = persistedIssues.length
    ? persistedIssues
    : errorMessage
      ? [{ level: "manual", message: errorMessage, field: "" }]
      : task.status === OCR_STATUS_PROCESSING || task.validationStatus === "PROCESSING"
        ? [{ level: "manual", message: "OCR正在识别，请稍候。", field: "" }]
        : [];
  return {
    id: task.id,
    documentId: task.documentId,
    requestId: task.requestId,
    documentType: task.documentType,
    status: task.status,
    validationStatus: task.validationStatus || "",
    errorMessage,
    rejectReason: task.rejectReason || "",
    rawText: task.rawText || "",
    confirmedAt: task.confirmedAt,
    rejectedAt: task.rejectedAt,
    fields: (task.results || []).map((result) => ({
      key: result.fieldKey,
      label: result.label,
      value: result.value || "",
      confidence: result.confidence == null ? null : Number(result.confidence),
    })),
    issues,
    expectedAmount: validationJson.expectedAmount == null ? null : Number(validationJson.expectedAmount),
    supplierName: String(validationJson.supplierName || ""),
    businessEntityName: String(validationJson.businessEntityName || ""),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
