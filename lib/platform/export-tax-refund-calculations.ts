import { normalizeCustomsDeclarationItemForTaxRefund, parseCustomsDeclarationDetailText, type CustomsDeclarationItemFields } from "../customs-declaration-parser";
import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { readR2Object } from "../r2";
import { parseVatInvoiceFields } from "./supplier-document-ocr";
import {
  FACTORY_SUPPLIER_COST_TYPES,
  TAX_REFUND_SUPPLIER_TYPES,
  runNonCriticalTask,
} from "./shared-constants";
import {
  codedError,
  guardedPrismaFindMany,
  nonEmpty,
  num,
} from "./shared-base-utils";
import { canWrite, permissionError } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { refreshTaxRefundCompletenessForOrder } from "./shared-tax-sync";
import { includeOrderRelations } from "./shared-order-relations";
import { roundMoney } from "./shared-order-calculations";
import { getTaxRefundFeatureSettings, isTaxRefundCalculationFeatureEnabled } from "./tax-refund-features";
import { recognizePdfTextWithOcr } from "./ocr-integration";
import { logOcrCallFailure, saveOcrRawResult } from "./ocr-raw-results";

type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type InvoiceLine = {
  documentId: string;
  invoiceNo: string;
  supplierId: string;
  supplierName: string;
  hsCode: string;
  productName: string;
  quantity: number;
  unit: string;
  amountWithTax: number;
  amountWithoutTax: number;
  taxRate: number;
};
type DeclarationGroup = {
  key: string;
  declarationNo: string;
  hsCode: string;
  productName: string;
  unit: string;
  quantity: number;
  amountCny: number;
  items: Array<{ id: string }>;
};
type InvoiceMatchResult = {
  status: string;
  reasons: string[];
  supplierCount: number;
  invoiceCount: number;
  invoiceQuantity: number;
  invoiceAmountWithTax: number;
  invoiceAmountWithoutTax: number;
  invoiceVatRate: number;
  differenceQuantity: number;
  differenceAmount: number;
  lines: InvoiceLine[];
};

const TAX_REFUND_AMOUNT_TOLERANCE_CNY = 1;
const TAX_REFUND_AMOUNT_TOLERANCE_PERCENT = 0.005;
const TAX_REFUND_OK_STATUSES = new Set(["整体匹配", "匹配", "多票合并匹配"]);

function cleanText(value: unknown) {
  return String(value || "").replace(/\u3000/g, " ").replace(/[ \t]+/g, " ").trim();
}

function normalizeComparable(value: unknown) {
  return cleanText(value)
    .toUpperCase()
    .replace(/[（）()【】\[\]{}《》<>，,。.\s·\-_/\\:：;；"'“”‘’]/g, "");
}

function normalizedHsCode(value: unknown) {
  return cleanText(value).replace(/\D/g, "");
}

function normalizedUnit(value: unknown) {
  const text = cleanText(value).toUpperCase();
  if (["PCS", "PC", "PIECE", "PIECES", "个", "只", "件"].includes(text)) return "个";
  if (["SET", "SETS", "套"].includes(text)) return "套";
  if (["KG", "KGS", "千克", "公斤"].includes(text)) return "千克";
  if (["TON", "TONS", "吨"].includes(text)) return "吨";
  return cleanText(value);
}

function plainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function customsParsedFromRecognition(recognized: { text?: string; parsedJson?: unknown }) {
  const parsed = plainRecord(recognized.parsedJson);
  const fallback = parseCustomsDeclarationDetailText(String(recognized.text || ""));
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems
    .map((item) => plainRecord(item))
    .map((item) => normalizeCustomsDeclarationItemForTaxRefund(item, {
      tradeTerm: cleanText(parsed.tradeTerm) || fallback.tradeTerm,
      currency: cleanText(parsed.currency).toUpperCase() || fallback.currency,
    }))
    .filter((item): item is CustomsDeclarationItemFields => Boolean(item));
  return {
    customsDeclarationNo: cleanText(parsed.customsDeclarationNo) || fallback.customsDeclarationNo,
    customsDeclarationDate: cleanText(parsed.customsDeclarationDate) || fallback.customsDeclarationDate,
    exportDate: cleanText(parsed.exportDate) || fallback.exportDate,
    tradeTerm: cleanText(parsed.tradeTerm) || fallback.tradeTerm,
    currency: cleanText(parsed.currency) || fallback.currency,
    totalAmount: num(parsed.totalAmount, 0) || fallback.totalAmount,
    customsDeclarationParseStatus: fallback.customsDeclarationParseStatus,
    customsDeclarationParseSource: fallback.customsDeclarationParseSource,
    customsDeclarationParseMessage: fallback.customsDeclarationParseMessage,
    items: items.length ? items : fallback.items,
  };
}

function toDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function nullableDecimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function rateNumber(value: unknown) {
  const text = cleanText(value).replace("%", "");
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return 0;
  return parsed > 1 ? parsed / 100 : parsed;
}

function declarationItemKey(item: Pick<DeclarationGroup, "declarationNo" | "hsCode" | "productName" | "unit">) {
  return [
    cleanText(item.declarationNo),
    normalizedHsCode(item.hsCode),
    normalizeComparable(item.productName),
    normalizedUnit(item.unit),
  ].join("|");
}

function amountMatches(declarationAmount: number, invoiceAmount: number) {
  const diff = Math.abs(declarationAmount - invoiceAmount);
  return diff <= Math.max(TAX_REFUND_AMOUNT_TOLERANCE_CNY, Math.abs(declarationAmount) * TAX_REFUND_AMOUNT_TOLERANCE_PERCENT);
}

function buildDeclarationGroups(items: Array<{
  id: string;
  declarationNo: string;
  hsCode: string;
  productName: string;
  unit?: string | null;
  quantity?: unknown;
  fobAmountCny?: unknown;
}>) {
  const groups = new Map<string, DeclarationGroup>();
  for (const item of items) {
    const groupInput = {
      declarationNo: item.declarationNo,
      hsCode: item.hsCode,
      productName: item.productName,
      unit: item.unit || "",
    };
    const key = declarationItemKey(groupInput);
    const current = groups.get(key) || {
      key,
      ...groupInput,
      quantity: 0,
      amountCny: 0,
      items: [],
    };
    current.quantity += num(item.quantity, 0);
    current.amountCny += num(item.fobAmountCny, 0);
    current.items.push({ id: item.id });
    groups.set(key, current);
  }
  return groups;
}

function latestTask<T extends { createdAt?: Date | string | null }>(tasks: T[] = []) {
  return [...tasks].sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime())[0] || null;
}

function invoiceLineFromDocument(document: Prisma.OrderDocumentGetPayload<{
  include: { supplier: true; cost: { include: { supplier: true } }; ocrTasks: true };
}>): InvoiceLine | null {
  const task = latestTask(document.ocrTasks || []);
  const fields = task?.resultJson && typeof task.resultJson === "object" && !Array.isArray(task.resultJson)
    ? task.resultJson as Record<string, unknown>
    : null;
  const parsed = (fields || (task?.rawText ? parseVatInvoiceFields(task.rawText) : null)) as Record<string, unknown> | null;
  if (!parsed) return null;
  const supplier = document.supplier || document.cost?.supplier || null;
  const taxRate = rateNumber(parsed.taxRate);
  const amountWithoutTax = num(parsed.amountWithoutTax, 0);
  const amountWithTax = num(parsed.amountWithTax, 0)
    || (amountWithoutTax && taxRate ? roundMoney(amountWithoutTax * (1 + taxRate)) : 0)
    || (amountWithoutTax && num(parsed.taxAmount, 0) ? roundMoney(amountWithoutTax + num(parsed.taxAmount, 0)) : 0);
  return {
    documentId: document.id,
    invoiceNo: cleanText(parsed.invoiceNo),
    supplierId: document.supplierId || document.cost?.supplierId || "",
    supplierName: supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.vendorName || "",
    hsCode: normalizedHsCode(parsed.hsCode),
    productName: cleanText(parsed.productName),
    quantity: num(parsed.quantity, 0),
    unit: normalizedUnit(parsed.unit),
    amountWithTax,
    amountWithoutTax,
    taxRate,
  };
}

async function supplierInvoiceLinesForOrder(orderId: string): Promise<InvoiceLine[]> {
  const documents = await guardedPrismaFindMany<Array<Prisma.OrderDocumentGetPayload<{ include: { supplier: true; cost: { include: { supplier: true } }; ocrTasks: true } }>>>(prisma.orderDocument, "orderDocument", "lib/platform/export-tax-refund-calculations.ts:supplierInvoiceLinesForOrder.documents", {
    where: {
      orderId,
      deletedAt: null,
      documentType: "SUPPLIER_INVOICE",
      relatedModule: "SUPPLIER",
      uploadStatus: "SUCCESS",
    },
    include: {
      supplier: true,
      cost: { include: { supplier: true } },
      ocrTasks: { orderBy: [{ createdAt: "desc" }] },
    },
  });
  return documents.map(invoiceLineFromDocument).filter((line): line is InvoiceLine => Boolean(line && line.productName));
}

function matchInvoices(group: DeclarationGroup, invoiceLines: InvoiceLine[], supplierCount: number): InvoiceMatchResult {
  const sameHs = invoiceLines.filter((line) => !line.hsCode || !group.hsCode || line.hsCode === normalizedHsCode(group.hsCode));
  const sameName = sameHs.filter((line) => normalizeComparable(line.productName) === normalizeComparable(group.productName));
  const sameUnit = sameName.filter((line) => normalizedUnit(line.unit) === normalizedUnit(group.unit));
  const lines = sameUnit;
  const invoiceQuantity = roundMoney(lines.reduce((sum, line) => sum + line.quantity, 0));
  const invoiceAmountWithTax = roundMoney(lines.reduce((sum, line) => sum + line.amountWithTax, 0));
  const invoiceAmountWithoutTax = roundMoney(lines.reduce((sum, line) => sum + line.amountWithoutTax, 0));
  const invoiceVatRate = lines.find((line) => line.taxRate > 0)?.taxRate || 0;
  const reasons: string[] = [];
  const invoiceCount = new Set(lines.map((line) => line.documentId)).size;
  const matchedSupplierCount = new Set(lines.map((line) => line.supplierId).filter(Boolean)).size;
  if (!invoiceLines.length) reasons.push("发票未匹配");
  else if (!sameHs.length) reasons.push("HS编码不一致");
  else if (!sameName.length) reasons.push("品名不一致");
  else if (!sameUnit.length) reasons.push("单位不一致");
  if (lines.length && Math.abs(invoiceQuantity - group.quantity) > 0.0001) reasons.push("数量不一致");
  if (lines.length && !amountMatches(group.amountCny, invoiceAmountWithTax || invoiceAmountWithoutTax)) reasons.push("金额异常");
  if (supplierCount > 0 && matchedSupplierCount < supplierCount) reasons.push("部分供应商未上传");
  const status = reasons[0] || (invoiceCount > 1 ? "多票合并匹配" : "匹配");
  return {
    status,
    reasons,
    supplierCount,
    invoiceCount,
    invoiceQuantity,
    invoiceAmountWithTax,
    invoiceAmountWithoutTax,
    invoiceVatRate,
    differenceQuantity: roundMoney(invoiceQuantity - group.quantity),
    differenceAmount: roundMoney((invoiceAmountWithTax || invoiceAmountWithoutTax) - group.amountCny),
    lines,
  };
}

async function supplierCountForOrder(orderId: string) {
  const costs = await guardedPrismaFindMany<Array<{ supplierId: string | null }>>(prisma.orderCost, "orderCost", "lib/platform/export-tax-refund-calculations.ts:supplierCountForOrder.costs", {
    where: {
      orderId,
      deletedAt: null,
      supplierId: { not: null },
      costType: { in: FACTORY_SUPPLIER_COST_TYPES },
      supplier: { is: { supplierType: { in: TAX_REFUND_SUPPLIER_TYPES } } },
    },
    select: { supplierId: true },
  });
  return new Set(costs.map((cost) => cost.supplierId).filter(Boolean)).size;
}

async function findCompanyHsForDeclarationItem(
  item: { hsCode?: string | null; productName?: string | null; unit?: string | null },
  match: InvoiceMatchResult,
  enabled: boolean,
) {
  if (!enabled) return null;
  const directHsCode = normalizedHsCode(item.hsCode);
  const invoiceHsCode = match.lines.map((line) => normalizedHsCode(line.hsCode)).find(Boolean) || "";
  const hsCode = directHsCode || invoiceHsCode;
  if (hsCode) {
    const direct = await prisma.companyHs.findFirst({
      where: { hsCode, deletedAt: null, isEnabled: true },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (direct) return direct;
  }
  const productName = cleanText(item.productName).slice(0, 80);
  if (!productName) return null;
  return prisma.companyHs.findFirst({
    where: {
      deletedAt: null,
      isEnabled: true,
      OR: [
        { cnName: { contains: productName, mode: "insensitive" } },
        { keywords: { contains: productName, mode: "insensitive" } },
        { enName: { contains: productName, mode: "insensitive" } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
  });
}

async function duplicateInvoiceUseReasons(orderId: string, lines: InvoiceLine[]) {
  const documentIds = lines.map((line) => line.documentId).filter(Boolean);
  if (!documentIds.length) return [];
  const existing = await guardedPrismaFindMany<Array<{ id: string; invoiceMatchJson: Prisma.JsonValue | null }>>(prisma.exportTaxRefundCalculation, "exportTaxRefundCalculation", "lib/platform/export-tax-refund-calculations.ts:duplicateInvoiceUseReasons.existing", {
    where: {
      orderId: { not: orderId },
      deletedAt: null,
    },
    select: { id: true, invoiceMatchJson: true },
    take: 500,
  });
  const duplicated = existing.some((row) => {
    const record = row.invoiceMatchJson && typeof row.invoiceMatchJson === "object" && !Array.isArray(row.invoiceMatchJson)
      ? row.invoiceMatchJson as Record<string, unknown>
      : {};
    const usedIds = Array.isArray(record.documentIds) ? record.documentIds.map((value) => String(value || "")) : [];
    return documentIds.some((documentId) => usedIds.includes(documentId));
  });
  return duplicated ? ["发票重复使用"] : [];
}

function serializeCalculationRow(row: Prisma.ExportTaxRefundCalculationGetPayload<{ include: { declarationItem: true; rate: true } }>) {
  const match = row.invoiceMatchJson && typeof row.invoiceMatchJson === "object" && !Array.isArray(row.invoiceMatchJson)
    ? row.invoiceMatchJson as Record<string, unknown>
    : {};
  return {
    id: row.id,
    declarationItemId: row.declarationItemId,
    declarationNo: row.declarationNo,
    hsCode: row.hsCode,
    productName: row.productName,
    declarationDate: row.declarationDate,
    fobCurrency: row.fobCurrency || "",
    fobAmount: row.fobAmount == null ? null : Number(row.fobAmount),
    exchangeRate: row.exchangeRate == null ? null : Number(row.exchangeRate),
    declarationAmountCny: row.declarationAmountCny == null ? null : Number(row.declarationAmountCny),
    rebateRate: row.rebateRate == null ? null : Number(row.rebateRate),
    vatRate: row.vatRate == null ? null : Number(row.vatRate),
    theoreticalRefundAmount: row.theoreticalRefundAmount == null ? null : Number(row.theoreticalRefundAmount),
    supplierInvoiceAmountWithoutTax: row.supplierInvoiceAmountWithoutTax == null ? null : Number(row.supplierInvoiceAmountWithoutTax),
    availableInputVatAmount: row.availableInputVatAmount == null ? null : Number(row.availableInputVatAmount),
    estimatedRefundAmount: row.estimatedRefundAmount == null ? null : Number(row.estimatedRefundAmount),
    invoiceMatchStatus: row.invoiceMatchStatus,
    calculationStatus: row.calculationStatus,
    abnormalReasons: Array.isArray(row.abnormalReasons) ? row.abnormalReasons : [],
    invoiceMatch: match,
    customsRmbAmount: row.declarationAmountCny == null ? null : Number(row.declarationAmountCny),
    inputVatAmount: row.availableInputVatAmount == null ? null : Number(row.availableInputVatAmount),
    supplierInvoiceAmountWithTax: num(match.supplierInvoiceAmountWithTax, 0) || num(match.invoiceAmountWithTax, 0) || null,
  };
}

function calculationStatusFromReasons(abnormalReasons: string[]) {
  if (abnormalReasons.includes("HS编码未维护")) return "HS未维护";
  if (abnormalReasons.includes("发票未匹配") || abnormalReasons.includes("发票缺失")) return "发票未匹配";
  if (abnormalReasons.some((reason) => [
    "数量不一致",
    "单位不一致",
    "品名不一致",
    "HS编码不一致",
    "金额异常",
    "部分供应商未上传",
  ].includes(reason))) return "资料不匹配";
  return abnormalReasons.length ? "资料异常" : "退税金额已计算";
}

export function serializeCustomsDeclarationItem(row: Prisma.ExportCustomsDeclarationItemGetPayload<{}>) {
  return {
    id: row.id,
    documentId: row.documentId || "",
    declarationNo: row.declarationNo,
    declarationDate: row.declarationDate,
    exportDate: row.exportDate,
    hsCode: row.hsCode,
    productName: row.productName,
    quantity: row.quantity == null ? null : Number(row.quantity),
    unit: row.unit || "",
    totalAmount: row.totalAmount == null ? null : Number(row.totalAmount),
    tradeTerm: row.tradeTerm || "",
    currency: row.currency || "",
    fobAmount: row.fobAmount == null ? null : Number(row.fobAmount),
    exchangeRate: row.exchangeRate == null ? null : Number(row.exchangeRate),
    fobAmountCny: row.fobAmountCny == null ? null : Number(row.fobAmountCny),
    confirmationStatus: row.confirmationStatus,
    source: row.source,
    sortOrder: row.sortOrder,
  };
}

export async function extractCustomsDeclarationItemsFromDocument(request: AuditRequestLike, actor: ActorLike, orderId: string, documentId: string) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限识别退税计算资料", 403);
  const document = await prisma.orderDocument.findFirst({
    where: { id: documentId, orderId, deletedAt: null, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS" },
  });
  if (!document?.storageKey) throw codedError("未找到可识别的报关单 PDF。", 404, "CUSTOMS_DOCUMENT_NOT_FOUND");
  const fileBuffer = await readR2Object(document.storageKey);
  if (!fileBuffer) throw codedError("未读取到报关单 PDF 文件。", 404, "CUSTOMS_DOCUMENT_FILE_EMPTY");
  const ocrStartedAt = Date.now();
  const recognized = await recognizePdfTextWithOcr(fileBuffer, "customsDeclaration", { requireText: true }).catch(async (error) => {
    const failureMessage = error instanceof Error ? error.message : String(error);
    const failureCode = (error as { code?: unknown } | null)?.code;
    logOcrCallFailure({
      documentId,
      orderId,
      documentType: "CUSTOMS_DECLARATION",
      provider: "ALIYUN",
      apiName: "CUSTOMS_DECLARATION_ITEMS_OCR",
      errorCode: failureCode,
      errorMessage: failureMessage,
    });
    await saveOcrRawResult({
      documentId,
      taxRefundId: orderId,
      orderId,
      documentType: "CUSTOMS_DECLARATION",
      provider: "ALIYUN",
      apiName: "CUSTOMS_DECLARATION_ITEMS_OCR",
      rawJson: {
        provider: "ALIYUN",
        apiName: "CUSTOMS_DECLARATION_ITEMS_OCR",
        errorCode: failureCode == null ? "" : String(failureCode),
        errorMessage: failureMessage,
      },
      parsedJson: {
        items: [],
        errorCode: failureCode == null ? "" : String(failureCode),
        errorMessage: failureMessage,
      },
      confidence: null,
      status: "FAILED",
      errorMessage: failureMessage,
    }).catch(() => null);
    throw error;
  });
  const parsed = customsParsedFromRecognition(recognized);
  const ocrDurationMs = Date.now() - ocrStartedAt;
  const itemMissingMessage = "已识别基础字段，但未解析到商品明细，请人工维护。";
  const actorId = nonEmpty(actor?.id);
  await prisma.$transaction(async (tx) => {
    await tx.ocrRawResult.deleteMany({
      where: {
        documentId,
        documentType: { in: ["CUSTOMS_DECLARATION", "CUSTOMS_ENTRY_FORM"] },
      },
    });
    await saveOcrRawResult({
      documentId,
      taxRefundId: orderId,
      orderId,
      documentType: "CUSTOMS_DECLARATION",
      provider: recognized.provider || "ALIYUN",
      apiName: recognized.apiName || recognized.source || "CUSTOMS_DECLARATION_OCR",
      rawJson: recognized.rawJson || null,
      parsedJson: {
        ...parsed,
        ocrDurationMs,
        rawJsonSaved: Boolean(recognized.rawJson),
        parsedJsonSaved: true,
        itemCount: parsed.items.length,
        fileName: document.fileName || document.originalName || "",
      },
      confidence: recognized.confidence ?? null,
      status: parsed.items.length ? "SUCCESS" : "PARTIAL",
      errorMessage: parsed.items.length ? "" : itemMissingMessage,
    }, tx);
    await tx.exportCustomsDeclarationItem.updateMany({
      where: { orderId, documentId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    for (const [index, item] of parsed.items.entries()) {
      await tx.exportCustomsDeclarationItem.create({
        data: {
          orderId,
          documentId,
          declarationNo: parsed.customsDeclarationNo || "",
          declarationDate: toDate(parsed.customsDeclarationDate),
          exportDate: toDate(parsed.exportDate),
          hsCode: "",
          productName: item.productName,
          specification: null,
          quantity: item.quantity || null,
          unit: item.unit || null,
          unitPrice: null,
          totalAmount: item.totalAmount || item.fobAmount || null,
          tradeTerm: item.tradeTerm || parsed.tradeTerm || null,
          currency: item.currency || parsed.currency || null,
          fobAmount: item.fobAmount || null,
          grossWeight: null,
          netWeight: null,
          originCountry: null,
          destinationCountry: null,
          exchangeRate: null,
          fobAmountCny: null,
          rawJson: {
            productName: item.productName || "",
            quantity: item.quantity || null,
            unit: item.unit || "",
            currency: item.currency || parsed.currency || "",
            totalAmount: item.totalAmount || item.fobAmount || null,
            declarationNo: parsed.customsDeclarationNo || "",
            declarationDate: parsed.customsDeclarationDate || "",
            exportDate: parsed.exportDate || "",
            tradeTerm: item.tradeTerm || parsed.tradeTerm || "",
            ocrApiName: recognized.apiName || recognized.source || "",
          } as unknown as Prisma.InputJsonValue,
          confirmationStatus: "PENDING_CONFIRMATION",
          source: recognized.apiName || recognized.source || "OCR_PDF",
          sortOrder: index,
        },
      });
    }
    await tx.receivableOrder.update({
      where: { id: orderId },
      data: {
        customsDeclarationNo: parsed.customsDeclarationNo || undefined,
        customsDeclarationDate: toDate(parsed.customsDeclarationDate) || undefined,
        customsParsedAt: new Date(),
        customsParseStatus: parsed.customsDeclarationParseStatus,
        customsParseMessage: parsed.items.length
          ? `${parsed.customsDeclarationParseMessage}\n已识别报关商品明细 ${parsed.items.length} 条，请确认。`
          : `${parsed.customsDeclarationParseMessage}\n${itemMissingMessage}`,
        customsDeclarationParseSource: recognized.apiName || recognized.source || "AUTO_PDF_TEXT",
        taxRefundStatus: parsed.items.length ? "CUSTOMS_RECOGNIZED_PENDING_CONFIRM" : "PROBLEM",
        updatedById: actorId || undefined,
      },
    });
  });
  await runNonCriticalTask("报关商品明细OCR日志写入", () => writeAudit(
    request,
    actor,
    "识别报关商品明细",
    "export_customs_declaration_items",
    orderId,
    null,
    {
      orderId,
      documentId,
      fileName: document.fileName || document.originalName || "",
      provider: recognized.provider || "ALIYUN",
      apiName: recognized.apiName || recognized.source || "CUSTOMS_DECLARATION_OCR",
      durationMs: ocrDurationMs,
      rawJsonSaved: Boolean(recognized.rawJson),
      parsedJsonSaved: true,
      itemCount: parsed.items.length,
      failureReason: parsed.items.length ? "" : itemMissingMessage,
      parsed,
    },
  ), { context: { orderId, documentId } });
  console.info("customs-ocr-result-persisted", {
    documentId,
    fileName: document.fileName || document.originalName || "",
    provider: recognized.provider || "ALIYUN",
    apiName: recognized.apiName || recognized.source || "CUSTOMS_DECLARATION_OCR",
    durationMs: ocrDurationMs,
    rawJsonSaved: Boolean(recognized.rawJson),
    parsedJsonSaved: true,
    itemCount: parsed.items.length,
    failureReason: parsed.items.length ? "" : itemMissingMessage,
  });
  await refreshOrderCompleteness(orderId);
  return getExportTaxRefundCalculationSummary(orderId);
}

export async function saveCustomsDeclarationItems(request: AuditRequestLike, actor: ActorLike, orderId: string, items: Array<Partial<CustomsDeclarationItemFields> & { id?: string; declarationNo?: string; declarationDate?: string; exportDate?: string; exchangeRate?: number }>) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限确认报关商品明细", 403);
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const before = await guardedPrismaFindMany<Array<Prisma.ExportCustomsDeclarationItemGetPayload<{}>>>(prisma.exportCustomsDeclarationItem, "exportCustomsDeclarationItem", "lib/platform/export-tax-refund-calculations.ts:saveCustomsDeclarationItems.before", { where: { orderId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }] });
  const cleanedItems = items
    .map((item) => {
      const core = normalizeCustomsDeclarationItemForTaxRefund(item, { currency: cleanText(item.currency), tradeTerm: cleanText(item.tradeTerm) });
      return core ? { input: item, core } : null;
    })
    .filter((item): item is { input: Partial<CustomsDeclarationItemFields> & { id?: string; declarationNo?: string; declarationDate?: string; exportDate?: string; exchangeRate?: number }; core: CustomsDeclarationItemFields } => Boolean(item));
  const submittedIds = cleanedItems.map(({ input }) => cleanText(input.id)).filter(Boolean);
  await prisma.$transaction(async (tx) => {
    await tx.exportCustomsDeclarationItem.updateMany({
      where: {
        orderId,
        deletedAt: null,
        ...(submittedIds.length ? { id: { notIn: submittedIds } } : {}),
      },
      data: { deletedAt: new Date() },
    });
    for (const [index, { input: item, core }] of cleanedItems.entries()) {
      const previous = item.id ? before.find((row) => row.id === item.id) : null;
      const exchangeRate = item.exchangeRate === undefined ? num(previous?.exchangeRate, 0) : num(item.exchangeRate, 0);
      const fobAmount = core.fobAmount;
      const data = {
        declarationNo: cleanText(item.declarationNo),
        declarationDate: toDate(item.declarationDate),
        exportDate: toDate(item.exportDate),
        hsCode: normalizedHsCode(item.hsCode),
        productName: core.productName,
        specification: null,
        quantity: core.quantity || null,
        unit: core.unit || null,
        unitPrice: null,
        totalAmount: core.totalAmount || fobAmount || null,
        tradeTerm: core.tradeTerm || null,
        currency: core.currency || null,
        fobAmount: fobAmount || null,
        grossWeight: null,
        netWeight: null,
        originCountry: null,
        destinationCountry: null,
        exchangeRate: exchangeRate || null,
        fobAmountCny: fobAmount && exchangeRate ? roundMoney(fobAmount * exchangeRate) : null,
        rawJson: {
          productName: core.productName,
          quantity: core.quantity,
          unit: core.unit,
          currency: core.currency,
          totalAmount: core.totalAmount,
          declarationNo: cleanText(item.declarationNo),
          declarationDate: cleanText(item.declarationDate),
          exportDate: cleanText(item.exportDate),
          tradeTerm: core.tradeTerm,
        } as Prisma.InputJsonValue,
        confirmationStatus: "CONFIRMED",
        source: "MANUAL_CONFIRMED",
        sortOrder: index,
        confirmedById: actorId,
        confirmedAt: new Date(),
      };
      if (item.id) {
        await tx.exportCustomsDeclarationItem.update({ where: { id: item.id }, data });
      } else {
        await tx.exportCustomsDeclarationItem.create({ data: { ...data, orderId } });
      }
    }
    const firstItem = cleanedItems.map(({ input }) => input).find((item) => cleanText(item.declarationNo) || cleanText(item.declarationDate));
    await tx.receivableOrder.update({
      where: { id: orderId },
      data: {
        customsDeclarationNo: firstItem?.declarationNo ? cleanText(firstItem.declarationNo) : undefined,
        customsDeclarationDate: firstItem?.declarationDate ? toDate(firstItem.declarationDate) : undefined,
        customsParsedAt: firstItem ? new Date() : undefined,
        customsParseStatus: firstItem ? "SUCCESS" : undefined,
        customsParseMessage: firstItem ? "报关商品明细已确认，报关单号和申报日期已同步回填。" : undefined,
        customsDeclarationParseSource: firstItem ? "MANUAL_CONFIRMED" : undefined,
        taxRefundStatus: "CUSTOMS_RECOGNIZED_PENDING_CONFIRM",
        updatedById: actorId,
      },
    });
  });
  const exchangeRateChanged = cleanedItems.some(({ input: item }) => {
    const previous = item.id ? before.find((row) => row.id === item.id) : null;
    return previous && num(previous.exchangeRate, 0) !== num(item.exchangeRate, 0);
  });
  await writeAudit(request, actor, "OCR识别结果确认", "export_customs_declaration_items", orderId, before, { orderId, itemCount: cleanedItems.length, deletedItemCount: before.length - submittedIds.length }).catch(() => null);
  if (exchangeRateChanged) {
    await writeAudit(request, actor, "手工修改汇率", "export_customs_declaration_items", orderId, before, { orderId, itemCount: cleanedItems.length }).catch(() => null);
  }
  if (await isTaxRefundCalculationFeatureEnabled()) return recalculateExportTaxRefund(request, actor, orderId);
  await refreshOrderCompleteness(orderId);
  return getExportTaxRefundCalculationSummary(orderId);
}

async function refreshOrderCompleteness(orderId: string) {
  const order = await prisma.receivableOrder.findUnique({ where: { id: orderId }, include: includeOrderRelations() });
  if (!order) return null;
  return refreshTaxRefundCompletenessForOrder(order);
}

export async function recalculateExportTaxRefund(request: AuditRequestLike, actor: ActorLike, orderId: string) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限重新计算退税金额", 403);
  const features = await getTaxRefundFeatureSettings();
  if (!features.enabled || !features.calculationEnabled) {
    throw codedError("退税计算功能已关闭，请到系统设置启用后再计算。", 403, "TAX_REFUND_FEATURE_DISABLED");
  }
  const actorId = nonEmpty(actor?.id);
  const [items, invoiceLines, supplierCount] = await Promise.all([
    guardedPrismaFindMany<Array<Prisma.ExportCustomsDeclarationItemGetPayload<{}>>>(prisma.exportCustomsDeclarationItem, "exportCustomsDeclarationItem", "lib/platform/export-tax-refund-calculations.ts:recalculateExportTaxRefund.items", {
      where: { orderId, deletedAt: null, confirmationStatus: "CONFIRMED" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    supplierInvoiceLinesForOrder(orderId),
    supplierCountForOrder(orderId),
  ]);
  if (!items.length) throw codedError("没有确认报关商品明细，不允许进入退税计算。", 400, "CUSTOMS_DECLARATION_ITEMS_CONFIRM_REQUIRED");
  const declarationGroups = buildDeclarationGroups(items);
  const results: Array<Prisma.ExportTaxRefundCalculationGetPayload<{ include: { declarationItem: true; rate: true } }>> = [];
  for (const item of items) {
    const declarationDate = item.declarationDate || null;
    const declarationAmountCny = num(item.fobAmountCny, 0) || (num(item.fobAmount, 0) && num(item.exchangeRate, 0) ? roundMoney(num(item.fobAmount, 0) * num(item.exchangeRate, 0)) : 0);
    const hsCode = normalizedHsCode(item.hsCode);
    const group = declarationGroups.get(declarationItemKey({
      declarationNo: item.declarationNo,
      hsCode: item.hsCode,
      productName: item.productName,
      unit: item.unit || "",
    }));
    const match = matchInvoices(group || {
      key: "",
      declarationNo: item.declarationNo,
      hsCode: item.hsCode,
      productName: item.productName,
      unit: item.unit || "",
      quantity: num(item.quantity, 0),
      amountCny: declarationAmountCny,
      items: [{ id: item.id }],
    }, invoiceLines, supplierCount);
    const duplicateReasons = await duplicateInvoiceUseReasons(orderId, match.lines);
    const companyHs = await findCompanyHsForDeclarationItem(item, match, features.companyHsLibraryEnabled);
    const effectiveHsCode = companyHs?.hsCode || hsCode || match.lines.map((line) => normalizedHsCode(line.hsCode)).find(Boolean) || "";
    const rebateRate = companyHs ? num(companyHs.rebateRate, 0) : 0;
    const vatRate = companyHs ? num(companyHs.vatRate, 0) : (match.invoiceVatRate || 0);
    const theoreticalRefundAmount = declarationAmountCny && rebateRate ? roundMoney(declarationAmountCny * rebateRate) : 0;
    const supplierInvoiceAmountWithTax = match.invoiceAmountWithTax
      || (match.invoiceAmountWithoutTax && vatRate ? roundMoney(match.invoiceAmountWithoutTax * (1 + vatRate)) : match.invoiceAmountWithoutTax);
    const supplierInvoiceAmountWithoutTax = supplierInvoiceAmountWithTax && vatRate
      ? roundMoney(supplierInvoiceAmountWithTax / (1 + vatRate))
      : match.invoiceAmountWithoutTax;
    const availableInputVatAmount = supplierInvoiceAmountWithTax && supplierInvoiceAmountWithoutTax
      ? roundMoney(supplierInvoiceAmountWithTax - supplierInvoiceAmountWithoutTax)
      : 0;
    const estimatedRefundAmount = theoreticalRefundAmount && availableInputVatAmount ? Math.min(theoreticalRefundAmount, availableInputVatAmount) : 0;
    const abnormalReasons = [
      ...(!features.companyHsLibraryEnabled ? ["企业HS编码库已关闭"] : []),
      ...(features.companyHsLibraryEnabled && !companyHs ? ["HS编码未维护"] : []),
      ...(companyHs && rebateRate <= 0 ? ["退税率为0"] : []),
      ...(!num(item.fobAmount, 0) && !declarationAmountCny ? ["报关金额缺失"] : []),
      ...(!num(item.exchangeRate, 0) && cleanText(item.currency).toUpperCase() !== "CNY" ? ["汇率缺失"] : []),
      ...match.reasons,
      ...duplicateReasons,
      ...(theoreticalRefundAmount > 0 && availableInputVatAmount > 0 && availableInputVatAmount < theoreticalRefundAmount ? ["发票金额不足"] : []),
    ].filter((reason, index, arr) => reason && arr.indexOf(reason) === index);
    const calculationStatus = calculationStatusFromReasons(abnormalReasons);
    const invoiceMatchJson = {
      supplierCount: match.supplierCount,
      invoiceCount: match.invoiceCount,
      invoiceQuantity: match.invoiceQuantity,
      invoiceAmountWithTax: supplierInvoiceAmountWithTax,
      invoiceAmountWithoutTax: match.invoiceAmountWithoutTax,
      supplierInvoiceAmountWithTax,
      supplierInvoiceAmountWithoutTax,
      availableInputVatAmount,
      differenceQuantity: match.differenceQuantity,
      differenceAmount: match.differenceAmount,
        documentIds: match.lines.map((line) => line.documentId),
        lines: match.lines,
        companyHs: companyHs ? {
          id: companyHs.id,
          hsCode: companyHs.hsCode,
        cnName: companyHs.cnName,
        unit: companyHs.unit,
        rebateRate,
        vatRate,
      } : null,
    };
    const saved = await prisma.exportTaxRefundCalculation.upsert({
      where: { declarationItemId: item.id },
      create: {
        orderId,
        declarationItemId: item.id,
        rateId: null,
        declarationNo: item.declarationNo,
        hsCode: effectiveHsCode,
        productName: item.productName,
        declarationDate,
        fobCurrency: item.currency,
        fobAmount: nullableDecimal(item.fobAmount),
        exchangeRate: nullableDecimal(item.exchangeRate),
        declarationAmountCny: declarationAmountCny || null,
        rebateRate: companyHs ? rebateRate : null,
        vatRate: vatRate || null,
        theoreticalRefundAmount: theoreticalRefundAmount || null,
        supplierInvoiceAmountWithoutTax: supplierInvoiceAmountWithoutTax || null,
        availableInputVatAmount: availableInputVatAmount || null,
        estimatedRefundAmount: estimatedRefundAmount || null,
        invoiceMatchStatus: match.status,
        calculationStatus,
        abnormalReasons: abnormalReasons as Prisma.InputJsonValue,
        invoiceMatchJson: invoiceMatchJson as Prisma.InputJsonValue,
        calculatedAt: new Date(),
        calculatedById: actorId || null,
      },
      update: {
        rateId: null,
        declarationNo: item.declarationNo,
        hsCode: effectiveHsCode,
        productName: item.productName,
        declarationDate,
        fobCurrency: item.currency,
        fobAmount: nullableDecimal(item.fobAmount),
        exchangeRate: nullableDecimal(item.exchangeRate),
        declarationAmountCny: declarationAmountCny || null,
        rebateRate: companyHs ? rebateRate : null,
        vatRate: vatRate || null,
        theoreticalRefundAmount: theoreticalRefundAmount || null,
        supplierInvoiceAmountWithoutTax: supplierInvoiceAmountWithoutTax || null,
        availableInputVatAmount: availableInputVatAmount || null,
        estimatedRefundAmount: estimatedRefundAmount || null,
        invoiceMatchStatus: match.status,
        calculationStatus,
        abnormalReasons: abnormalReasons as Prisma.InputJsonValue,
        invoiceMatchJson: invoiceMatchJson as Prisma.InputJsonValue,
        calculatedAt: new Date(),
        calculatedById: actorId || null,
        deletedAt: null,
      },
      include: { declarationItem: true, rate: true },
    });
    results.push(saved);
  }
  const hasException = results.some((row) => row.calculationStatus !== "退税金额已计算");
  const hasInvoiceMatched = results.every((row) => TAX_REFUND_OK_STATUSES.has(row.invoiceMatchStatus));
  const hasRateMatched = results.every((row) => row.rebateRate != null);
  const hasHsNotMaintained = results.some((row) => Array.isArray(row.abnormalReasons) && row.abnormalReasons.includes("HS编码未维护"));
  const nextStatus = hasHsNotMaintained
    ? "HS_NOT_MAINTAINED"
    : hasException
    ? "PROBLEM"
    : results.every((row) => row.calculationStatus === "退税金额已计算")
      ? "REFUND_CALCULATED"
      : hasInvoiceMatched
        ? "SUPPLIER_INVOICE_MATCHED"
        : hasRateMatched
          ? "REBATE_RATE_MATCHED"
          : "CUSTOMS_RECOGNIZED_PENDING_CONFIRM";
  await prisma.receivableOrder.update({ where: { id: orderId }, data: { taxRefundStatus: nextStatus, updatedById: actorId || undefined } });
  await writeAudit(request, actor, "重新计算退税金额", "export_tax_refund_calculations", orderId, null, {
    orderId,
    status: nextStatus,
    estimatedRefundAmount: roundMoney(results.reduce((sum, row) => sum + Number(row.estimatedRefundAmount || 0), 0)),
    exceptionCount: results.filter((row) => row.calculationStatus === "资料异常").length,
  }).catch(() => null);
  await writeAudit(request, actor, "供应商发票匹配", "export_tax_refund_calculations", orderId, null, {
    orderId,
    statuses: results.map((row) => row.invoiceMatchStatus),
  }).catch(() => null);
  await writeAudit(request, actor, "重新计算利润", "receivable_orders", orderId, null, {
    orderId,
    estimatedTaxRefundIncome: roundMoney(results.reduce((sum, row) => sum + Number(row.estimatedRefundAmount || 0), 0)),
  }).catch(() => null);
  await refreshOrderCompleteness(orderId);
  return getExportTaxRefundCalculationSummary(orderId);
}

export async function getExportTaxRefundCalculationSummary(orderId: string) {
  const [items, calculations] = await Promise.all([
    guardedPrismaFindMany<Array<Prisma.ExportCustomsDeclarationItemGetPayload<{}>>>(prisma.exportCustomsDeclarationItem, "exportCustomsDeclarationItem", "lib/platform/export-tax-refund-calculations.ts:getExportTaxRefundCalculationSummary.items", { where: { orderId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    guardedPrismaFindMany<Array<Prisma.ExportTaxRefundCalculationGetPayload<{ include: { declarationItem: true; rate: true } }>>>(prisma.exportTaxRefundCalculation, "exportTaxRefundCalculation", "lib/platform/export-tax-refund-calculations.ts:getExportTaxRefundCalculationSummary.calculations", {
      where: { orderId, deletedAt: null },
      include: { declarationItem: true, rate: true },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);
  const rows = calculations.map(serializeCalculationRow);
  const estimatedRefundAmount = roundMoney(rows.reduce((sum, row) => sum + Number(row.estimatedRefundAmount || 0), 0));
  const abnormalReasons = rows.flatMap((row) => row.abnormalReasons.map((reason) => String(reason || ""))).filter(Boolean);
  return {
    customsDeclarationItems: items.map(serializeCustomsDeclarationItem),
    exportTaxRefundCalculations: rows,
    exportTaxRefundSummary: {
      estimatedRefundAmount,
      calculationStatus: abnormalReasons.length ? "资料异常" : rows.length ? "退税金额已计算" : "",
      abnormalReasons: abnormalReasons.filter((reason, index, arr) => arr.indexOf(reason) === index),
    },
  };
}
