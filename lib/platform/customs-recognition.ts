import fs from "node:fs/promises";
import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import * as customsDeclarationParser from "../customs-declaration-parser";
import {
  CUSTOMS_FILE_READ_FAILED_MESSAGE,
  LOGISTICS_OPERATOR_ROLE,
  canWrite,
  codedError,
  customsParseStatusLabel,
  dateFromInput,
  dateToInput,
  includeOrderRelations,
  isCustomsDeclarationDocumentType,
  isPlainRecord,
  nonEmpty,
  normalizeOrderDocumentType,
  permissionError,
  runNonCriticalTask,
  serializeCustomsRecognition,
  serializeOrder,
  writeAudit,
} from "./shared";
import {
  canAccessDomesticLogisticsOrder,
  canUseDomesticLogisticsDocumentScope,
} from "./masters-access";
import { orderAccessWhere } from "./order-access";
import { recognizePdfTextWithOcr } from "./ocr-integration";
import { logOcrCallFailure, saveOcrRawResult } from "./ocr-raw-results";
import { tryAutoShippingDocumentsNotification } from "./shipping-documents";

type CustomsDocumentRuntimeFields = {
  filePath?: string | null;
  fileUrl?: string | null;
  storageKey?: string | null;
  uploadSource?: string | null;
};
type CustomsActor = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
  supplierId?: string | null;
} | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type CustomsFields = {
  customsDeclarationNo?: string;
  customsDeclarationDate?: string;
};
type CustomsFieldKey = keyof CustomsFields;
type CustomsParseStatus = "SUCCESS" | "PARTIAL" | "FAILED";
type CustomsOrderLike = {
  id?: string;
  customsDeclarationNo?: string | null;
  customsDeclarationDate?: Date | string | null;
  customsParsedAt?: Date | string | null;
  customsParseStatus?: string | null;
  customsParseMessage?: string | null;
  customsDeclarationParseSource?: string | null;
};
type CustomsDocumentLike = CustomsDocumentRuntimeFields & {
  id?: string;
  orderId?: string;
  documentType?: string;
  uploadStatus?: string | null;
};
type CustomsRecognitionDocument = CustomsDocumentLike & {
  id: string;
  orderId: string;
  documentType: string;
};
type CustomsRecognitionBuildInput = {
  document?: CustomsDocumentLike;
  parsedFields?: CustomsFields;
  currentFields?: CustomsFields;
  status?: CustomsParseStatus;
  message?: string;
  applied?: boolean;
  requiresConfirmation?: boolean;
  conflictFields?: string[];
  order?: unknown;
};
type MergedCustomsFields = {
  fields: CustomsFields;
  preserved: string[];
  conflictFields: string[];
  currentFields: CustomsFields;
};
type CustomsFailureOptions = {
  allowManualFailure?: boolean;
  clearFields?: boolean;
  technicalError?: unknown;
  publicMessage?: string;
  document?: CustomsDocumentLike;
};
type CustomsRecognitionInput = Record<string, unknown>;
type ResolveCustomsDocumentInput = {
  orderId: string;
  documentId?: string;
  documentType?: string;
};
type ParseCustomsDocumentResult = {
  fields: CustomsFields;
  status: CustomsParseStatus;
  source: string;
  message: string;
  provider?: string;
  apiName?: string;
  rawJson?: unknown;
  parsedJson?: unknown;
  confidence?: number | null;
};
type ParseAndApplyCustomsOptions = {
  force?: boolean;
  action?: string;
  failureAction?: string;
  allowManualFailure?: boolean;
  replaceWithParsedFields?: boolean;
  clearFieldsOnFailure?: boolean;
  returnDetails?: boolean;
};
type ErrorLike = {
  code?: unknown;
  status?: unknown;
  name?: unknown;
  message?: unknown;
  details?: unknown;
};

function customsDocumentRuntimeFields(document: unknown): CustomsDocumentRuntimeFields {
  return (document || {}) as CustomsDocumentRuntimeFields;
}

function errorLike(error: unknown): ErrorLike {
  return error && typeof error === "object" ? error as ErrorLike : {};
}

function actorRole(actor: CustomsActor) {
  return String(actor?.role || "");
}

function errorCode(error: unknown) {
  return String(errorLike(error).code || "");
}

function errorStatus(error: unknown, fallback = 500) {
  const status = Number(errorLike(error).status || fallback);
  return Number.isFinite(status) ? status : fallback;
}

function errorMessage(error: unknown) {
  return String(errorLike(error).message || "");
}

function errorDetails(error: unknown): Record<string, unknown> {
  const details = errorLike(error).details;
  return isPlainRecord(details) ? details : {};
}

function normalizeCustomsInput(input: CustomsRecognitionInput = {}): CustomsFields {
  return {
    customsDeclarationNo: nonEmpty(String(input.customsDeclarationNo || "")).slice(0, 80) || "",
    customsDeclarationDate: customsDeclarationParser.normalizeCustomsDate(String(input.customsDeclarationDate || "")) || "",
  };
}

function customsUpdateData(fields: CustomsFields = {}, status: CustomsParseStatus = "SUCCESS", message = "", source = customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO) {
  return {
    customsDeclarationNo: fields.customsDeclarationNo || null,
    customsDeclarationDate: fields.customsDeclarationDate ? dateFromInput(fields.customsDeclarationDate) : null,
    customsParsedAt: new Date(),
    customsParseStatus: status,
    customsParseMessage: message || null,
    customsDeclarationParseSource: source,
  };
}

function hasCustomsRecognitionValue(fields: CustomsFields = {}) {
  return Boolean(fields.customsDeclarationNo || fields.customsDeclarationDate);
}

function currentCustomsFields(before: CustomsOrderLike | null = null): CustomsFields {
  const declarationDate = before?.customsDeclarationDate instanceof Date
    ? dateToInput(before.customsDeclarationDate)
    : customsDeclarationParser.normalizeCustomsDate(String(before?.customsDeclarationDate || ""));
  return {
    customsDeclarationNo: before?.customsDeclarationNo || "",
    customsDeclarationDate: declarationDate,
  };
}

function buildCustomsRecognitionResult({
  document = {} as CustomsDocumentLike,
  parsedFields = {},
  currentFields = {},
  status = "FAILED",
  message = "",
  applied = false,
  requiresConfirmation = false,
  conflictFields = [],
  order = null,
}: CustomsRecognitionBuildInput = {}) {
  const orderRecord = order && typeof order === "object" ? order as { id?: string } : null;
  return {
    attempted: true,
    documentId: document?.id || "",
    orderId: document?.orderId || orderRecord?.id || "",
    documentType: document?.documentType || "",
    customsDeclarationNo: parsedFields.customsDeclarationNo || "",
    customsDeclarationDate: parsedFields.customsDeclarationDate || "",
    currentCustomsDeclarationNo: currentFields.customsDeclarationNo || "",
    currentCustomsDeclarationDate: currentFields.customsDeclarationDate || "",
    customsParseStatus: status,
    customsParseStatusLabel: customsParseStatusLabel(status),
    customsParseMessage: message || customsDeclarationParser.customsParseMessage(parsedFields, status),
    applied: Boolean(applied),
    requiresConfirmation: Boolean(requiresConfirmation),
    conflictFields,
    order,
  };
}

function mergeCustomsFields(parsedFields: CustomsFields = {}, before: CustomsOrderLike | null = null, force = false): MergedCustomsFields {
  const preserved: string[] = [];
  const conflictFields: string[] = [];
  const currentFields = currentCustomsFields(before);
  const fields = { ...parsedFields };
  if (fields.customsDeclarationNo && currentFields.customsDeclarationNo && fields.customsDeclarationNo !== currentFields.customsDeclarationNo && !force) {
    conflictFields.push("customsDeclarationNo");
    fields.customsDeclarationNo = currentFields.customsDeclarationNo;
    preserved.push("customsDeclarationNo");
  } else if (!fields.customsDeclarationNo && currentFields.customsDeclarationNo) {
    fields.customsDeclarationNo = currentFields.customsDeclarationNo;
    preserved.push("customsDeclarationNo");
  }
  if (fields.customsDeclarationDate && currentFields.customsDeclarationDate && fields.customsDeclarationDate !== currentFields.customsDeclarationDate && !force) {
    conflictFields.push("customsDeclarationDate");
    fields.customsDeclarationDate = currentFields.customsDeclarationDate;
    preserved.push("customsDeclarationDate");
  } else if (!fields.customsDeclarationDate && currentFields.customsDeclarationDate) {
    fields.customsDeclarationDate = currentFields.customsDeclarationDate;
    preserved.push("customsDeclarationDate");
  }
  return { fields, preserved, conflictFields, currentFields };
}

async function parseCustomsDocumentBuffer(buffer: Buffer, _document: CustomsDocumentLike = {}, options: { requireText?: boolean } = {}): Promise<ParseCustomsDocumentResult> {
  const recognized = await recognizePdfTextWithOcr(buffer, "customsDeclaration", options);
  const parsed = recognized.parsedJson && typeof recognized.parsedJson === "object" && !Array.isArray(recognized.parsedJson)
    ? recognized.parsedJson as Record<string, unknown>
    : {};
  const result = customsDeclarationParser.parseCustomsDeclarationText(recognized.text);
  const fields = {
    customsDeclarationNo: String(parsed.customsDeclarationNo || result.customsDeclarationNo || ""),
    customsDeclarationDate: String(parsed.customsDeclarationDate || result.customsDeclarationDate || ""),
  };
  const status = customsDeclarationParser.customsParseStatusFromFields(fields);
  return {
    fields,
    status,
    source: recognized.apiName || recognized.source || customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
    message: customsDeclarationParser.customsParseMessage(fields, status),
    provider: recognized.provider,
    apiName: recognized.apiName || recognized.source,
    rawJson: recognized.rawJson || null,
    parsedJson: recognized.parsedJson || result,
    confidence: recognized.confidence ?? null,
  };
}

function customsFailurePublicMessage(error: unknown, fallback = "报关单识别失败") {
  const code = errorCode(error);
  if (code === "CUSTOMS_PDF_READ_FAILED" || code === "R2_OBJECT_NOT_FOUND" || code === "R2_STREAM_FAILED") {
    return CUSTOMS_FILE_READ_FAILED_MESSAGE;
  }
  const message = errorMessage(error);
  if (/ENOENT|no such file|storage|R2|S3|对象存储|文件流|file path/i.test(message)) {
    return CUSTOMS_FILE_READ_FAILED_MESSAGE;
  }
  return fallback;
}

function customsFailureDetails(error: unknown, document: CustomsDocumentLike = {}) {
  return {
    documentId: document?.id || "",
    orderId: document?.orderId || "",
    documentType: document?.documentType || "",
    storageKey: document?.storageKey || "",
    filePath: document?.filePath || "",
    fileUrl: document?.fileUrl || "",
    errorCode: errorCode(error),
    errorName: String(errorLike(error).name || ""),
    errorMessage: errorMessage(error),
  };
}

function wrapCustomsFileReadError(error: unknown, document: CustomsDocumentLike = {}) {
  const wrapped = codedError(CUSTOMS_FILE_READ_FAILED_MESSAGE, errorStatus(error), "CUSTOMS_PDF_READ_FAILED");
  wrapped.details = customsFailureDetails(error, document);
  return wrapped;
}

function isMissingCustomsFileError(error: unknown = {}) {
  const code = errorCode(error);
  const message = errorMessage(error);
  return [
    "CUSTOMS_FILE_LOCATION_MISSING",
    "R2_OBJECT_NOT_FOUND",
    "ENOENT",
  ].includes(code)
    || /ENOENT|no such file|对象不存在|key 缺失|存储信息缺失|NoSuchKey/i.test(message);
}

function specificCustomsFileReadError(error: unknown = {}) {
  const wrappedCode = errorCode(error);
  const details = errorDetails(error);
  const sourceCode = String(details.errorCode || "");
  const sourceMessage = String(details.errorMessage || errorMessage(error));
  if (isMissingCustomsFileError({ code: sourceCode || wrappedCode, message: sourceMessage })) {
    return codedError("文件不存在", 404, "CUSTOMS_FILE_NOT_FOUND");
  }
  return codedError("文件无法读取", errorStatus(error), "CUSTOMS_FILE_UNREADABLE");
}

function specificCustomsParseError(error: unknown = {}) {
  if (errorCode(error) === "CUSTOMS_PDF_NO_TEXT") {
    return codedError("PDF未提取到文字，请手工填写报关单号和申报日期。", 422, "CUSTOMS_PDF_NO_TEXT");
  }
  return codedError(errorMessage(error) || "文件无法读取", errorStatus(error), errorCode(error) || "CUSTOMS_PARSE_FAILED");
}

function missingCustomsFieldMessages(fields: CustomsFields = {}) {
  const missing: string[] = [];
  if (!fields.customsDeclarationNo) missing.push("未识别到报关单号");
  if (!fields.customsDeclarationDate) missing.push("未识别到申报日期");
  return missing;
}

async function readCustomsDeclarationPdfBuffer(document: CustomsDocumentLike = {}) {
  try {
    if (document.filePath) {
      return await fs.readFile(document.filePath);
    }
    if (document.storageKey) {
      return await readR2Object(document.storageKey);
    }
    if (document.fileUrl) {
      const url = String(document.fileUrl || "");
      if (/^https?:\/\//i.test(url)) {
        const response = await fetch(url);
        if (!response.ok) throw codedError("报关单文件 URL 读取失败", response.status, "CUSTOMS_FILE_URL_READ_FAILED");
        return Buffer.from(await response.arrayBuffer());
      }
      return await fs.readFile(url);
    }
    throw codedError("报关单文件存储信息缺失，无法读取。", 404, "CUSTOMS_FILE_LOCATION_MISSING");
  } catch (error: unknown) {
    throw wrapCustomsFileReadError(error, document);
  }
}

async function applyCustomsParseFailure(
  request: AuditRequestLike,
  actor: CustomsActor,
  orderId: string,
  message: string,
  code = "CUSTOMS_PARSE_FAILED",
  action = "自动识别失败",
  options: CustomsFailureOptions = {},
) {
  const before = await prisma.receivableOrder.findUnique({ where: { id: orderId } });
  const allowManualFailure = Boolean(options?.allowManualFailure);
  const clearFields = Boolean(options?.clearFields);
  const technicalError = options?.technicalError || null;
  const publicMessage = options?.publicMessage || message || "识别失败";
  const manualProtected = before?.customsDeclarationParseSource === "MANUAL" || before?.customsParseStatus === "MANUAL";
  if (!before || (manualProtected && !allowManualFailure)) {
    return before ? serializeOrder(before) : null;
  }
  const data = {
    ...(clearFields ? {
      customsDeclarationNo: null,
      customsDeclarationDate: null,
    } : {}),
    customsParsedAt: new Date(),
    customsParseStatus: "FAILED",
    customsParseMessage: publicMessage,
    customsDeclarationParseSource: manualProtected
      ? before.customsDeclarationParseSource || customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL
      : customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
  };
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data,
    include: includeOrderRelations(),
  });
  const beforeFailure = {
    customsParseStatus: before.customsParseStatus,
    customsParseMessage: before.customsParseMessage,
    customsDeclarationParseSource: before.customsDeclarationParseSource,
  };
  const afterFailure: Record<string, unknown> = {
    customsParseStatus: "FAILED",
    customsParseMessage: publicMessage,
    customsDeclarationParseSource: customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
    code,
  };
  if (technicalError) afterFailure.technicalError = customsFailureDetails(technicalError, options?.document || {});
  await runNonCriticalTask("报关单识别失败日志写入", () => writeAudit(request, actor, action, "receivable_orders", orderId, beforeFailure, afterFailure));
  return serializeOrder(order);
}

async function latestCustomsEntryDocument(orderId: string) {
  return prisma.orderDocument.findFirst({
    where: { orderId, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS", deletedAt: null },
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
  });
}

async function resolveCustomsDeclarationDocument({ orderId, documentId, documentType = "CUSTOMS_ENTRY_FORM" }: ResolveCustomsDocumentInput) {
  const normalizedDocumentType = normalizeOrderDocumentType(documentType);
  if (!documentId) {
    return latestCustomsEntryDocument(orderId);
  }
  const document = await prisma.orderDocument.findFirst({
    where: {
      id: documentId,
      orderId,
      deletedAt: null,
    },
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
  });
  if (!document) return null;
  if (document.documentType !== normalizedDocumentType) {
    const error = permissionError("该文件不是报关单文件，无法执行报关单识别", 400);
    error.code = "INVALID_CUSTOMS_DOCUMENT_TYPE";
    throw error;
  }
  if (document.uploadStatus !== "SUCCESS") {
    const error = permissionError("该报关单文件尚未上传成功，无法识别", 400);
    error.code = "CUSTOMS_DOCUMENT_NOT_READY";
    throw error;
  }
  const documentRuntime = customsDocumentRuntimeFields(document);
  if (!document.storageKey && !documentRuntime.filePath && !document.fileUrl) {
    const error = permissionError("报关单文件存储信息缺失，无法读取", 500);
    error.code = "CUSTOMS_FILE_LOCATION_MISSING";
    throw error;
  }
  return document;
}

export async function parseAndApplyCustomsDocument(
  request: AuditRequestLike,
  actor: CustomsActor,
  document: CustomsRecognitionDocument,
  buffer: Buffer,
  {
    force = false,
    action = "自动识别成功",
    failureAction = "自动识别失败",
    allowManualFailure = false,
    replaceWithParsedFields = false,
    clearFieldsOnFailure = false,
    returnDetails = false,
  }: ParseAndApplyCustomsOptions = {},
) {
  const before = await prisma.receivableOrder.findUnique({ where: { id: document.orderId } });
  if (!before) throw permissionError("应收订单不存在", 404);
  const manualProtected = before.customsDeclarationParseSource === "MANUAL" || before.customsParseStatus === "MANUAL";
  try {
    const { fields, status, source, message, provider, apiName, rawJson, parsedJson, confidence } = await parseCustomsDocumentBuffer(buffer, document);
    await saveOcrRawResult({
      documentId: document.id,
      orderId: document.orderId,
      documentType: document.documentType,
      provider: provider || "ALIYUN",
      apiName: apiName || source || "CUSTOMS_DECLARATION_OCR",
      rawJson,
      parsedJson,
      confidence: confidence ?? null,
      status: status === "SUCCESS" ? "SUCCESS" : status === "PARTIAL" ? "PARTIAL" : "FAILED",
      errorMessage: status === "SUCCESS" ? "" : message,
    }).catch((error) => {
      console.error("customs-ocr-raw-result-save-failed", {
        documentId: document.id,
        orderId: document.orderId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    if (!hasCustomsRecognitionValue(fields)) {
      const failureOrder = await applyCustomsParseFailure(request, actor, document.orderId, message, "CUSTOMS_PARSE_NO_FIELDS", failureAction, {
        allowManualFailure,
        clearFields: clearFieldsOnFailure,
      });
      return returnDetails
        ? buildCustomsRecognitionResult({
          document,
          parsedFields: fields,
          currentFields: currentCustomsFields(before),
          status,
          message,
          applied: false,
          order: failureOrder,
        })
        : failureOrder;
    }
    if (replaceWithParsedFields) {
      const order = await prisma.receivableOrder.update({
        where: { id: document.orderId },
        data: customsUpdateData(
          fields,
          customsDeclarationParser.customsParseStatusFromFields(fields),
          message,
          source,
        ),
        include: includeOrderRelations(),
      });
      await runNonCriticalTask("报关单识别日志写入", () => writeAudit(request, actor, status === "SUCCESS" ? action : "自动部分识别报关单信息", "receivable_orders", order.id, serializeCustomsRecognition(before), {
        ...serializeCustomsRecognition(order),
        documentId: document.id,
        uploadSource: customsDocumentRuntimeFields(document).uploadSource || "",
        recognitionSource: source,
      }));
      const serializedOrder = serializeOrder(order);
      return returnDetails
        ? buildCustomsRecognitionResult({
          document,
          parsedFields: fields,
          currentFields: currentCustomsFields(before),
          status,
          message,
          applied: true,
          order: serializedOrder,
        })
        : serializedOrder;
    }
    const merged = mergeCustomsFields(fields, before, force);
    const updateSource = merged.preserved.length
      ? customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL
      : source;
    if (merged.conflictFields.length && !force) {
      const shouldApplyPartial = Boolean(
        (fields.customsDeclarationNo && !merged.currentFields.customsDeclarationNo)
        || (fields.customsDeclarationDate && !merged.currentFields.customsDeclarationDate)
      );
      if (shouldApplyPartial) {
        const order = await prisma.receivableOrder.update({
          where: { id: document.orderId },
          data: customsUpdateData(
            merged.fields,
            customsDeclarationParser.customsParseStatusFromFields(merged.fields),
            "已识别新报关单信息，已有字段待确认覆盖。",
            updateSource,
          ),
          include: includeOrderRelations(),
        });
        await runNonCriticalTask("报关单识别待确认日志写入", () => writeAudit(request, actor, "自动识别报关单信息待确认", "receivable_orders", order.id, serializeCustomsRecognition(before), {
          ...serializeCustomsRecognition(order),
          documentId: document.id,
          conflictFields: merged.conflictFields,
        }));
        return returnDetails
          ? buildCustomsRecognitionResult({
            document,
            parsedFields: fields,
            currentFields: merged.currentFields,
            status,
            message,
            applied: true,
            requiresConfirmation: true,
            conflictFields: merged.conflictFields,
            order: serializeOrder(order),
          })
          : null;
      }
      return returnDetails
        ? buildCustomsRecognitionResult({
          document,
          parsedFields: fields,
          currentFields: merged.currentFields,
          status,
          message,
          applied: false,
          requiresConfirmation: true,
          conflictFields: merged.conflictFields,
        })
        : null;
    }
    if (manualProtected && !force && (merged.currentFields.customsDeclarationNo || merged.currentFields.customsDeclarationDate)) {
      return returnDetails
        ? buildCustomsRecognitionResult({
          document,
          parsedFields: fields,
          currentFields: merged.currentFields,
          status,
          message,
          applied: false,
          requiresConfirmation: true,
              conflictFields: (["customsDeclarationNo", "customsDeclarationDate"] as CustomsFieldKey[]).filter((field) => merged.currentFields[field]),
        })
        : null;
    }
    const order = await prisma.receivableOrder.update({
      where: { id: document.orderId },
      data: customsUpdateData(
        merged.fields,
        customsDeclarationParser.customsParseStatusFromFields(merged.fields),
        message,
        updateSource,
      ),
      include: includeOrderRelations(),
    });
    await runNonCriticalTask("报关单识别日志写入", () => writeAudit(request, actor, status === "SUCCESS" ? action : "自动部分识别报关单信息", "receivable_orders", order.id, serializeCustomsRecognition(before), {
      ...serializeCustomsRecognition(order),
      documentId: document.id,
      uploadSource: customsDocumentRuntimeFields(document).uploadSource || "",
      recognitionSource: source,
      preservedManualFields: merged.preserved,
    }));
    const serializedOrder = serializeOrder(order);
    return returnDetails
      ? buildCustomsRecognitionResult({
        document,
        parsedFields: fields,
        currentFields: merged.currentFields,
        status,
        message,
        applied: true,
        order: serializedOrder,
      })
      : serializedOrder;
  } catch (error: unknown) {
    logOcrCallFailure({
      documentId: document.id,
      orderId: document.orderId,
      documentType: document.documentType,
      provider: "ALIYUN",
      apiName: "CUSTOMS_DECLARATION_OCR",
      errorCode: errorCode(error),
      errorMessage: errorMessage(error),
    });
    const publicMessage = customsFailurePublicMessage(error, errorMessage(error) || "报关单识别失败");
    const failureOrder = await applyCustomsParseFailure(request, actor, document.orderId, publicMessage, errorCode(error) || "CUSTOMS_PARSE_FAILED", failureAction, {
      allowManualFailure,
      clearFields: clearFieldsOnFailure,
      publicMessage,
      technicalError: error,
      document,
    });
    return returnDetails
      ? buildCustomsRecognitionResult({
        document,
        parsedFields: {},
        currentFields: currentCustomsFields(before),
        status: "FAILED",
        message: publicMessage,
        applied: false,
        order: failureOrder,
      })
      : failureOrder;
  }
}

export async function recognizeUploadedCustomsDocument(request: AuditRequestLike, actor: CustomsActor, documentId: string, input: CustomsRecognitionInput = {}) {
  if (!canWrite(actor, "documents") || !canWrite(actor, "domesticLogistics")) {
    throw permissionError("没有权限触发报关单识别", 403);
  }
  const document = await prisma.orderDocument.findFirst({
    where: { id: documentId, deletedAt: null },
    include: {
      order: {
        include: {
          customer: true,
          createdBy: true,
          salesperson: true,
          logisticsSuppliers: { select: { supplierId: true } },
        },
      },
      cost: { include: { supplier: true } },
      supplier: true,
      uploadedBy: true,
    },
  });
  if (!document) throw permissionError("报关单文件不存在", 404);
  if (!isCustomsDeclarationDocumentType(document.documentType)) {
    const error = permissionError("该文件不是报关单文件，无法执行报关单识别", 400);
    error.code = "INVALID_CUSTOMS_DOCUMENT_TYPE";
    throw error;
  }
  if (!canUseDomesticLogisticsDocumentScope(actor, document.documentType) || !canAccessDomesticLogisticsOrder(actor, document.order)) {
    throw permissionError("无权限触发该订单报关单识别", 403);
  }
  if (document.uploadStatus !== "SUCCESS") {
    const error = permissionError("该报关单文件尚未上传成功，无法识别", 400);
    error.code = "CUSTOMS_DOCUMENT_NOT_READY";
    throw error;
  }
  const buffer = await readCustomsDeclarationPdfBuffer(document);
  return parseAndApplyCustomsDocument(request, actor, document, buffer, {
    force: input.confirmOverride === true,
    action: input.confirmOverride === true ? "确认覆盖报关单识别信息" : "自动识别成功",
    failureAction: "自动识别失败",
    allowManualFailure: true,
    replaceWithParsedFields: true,
    clearFieldsOnFailure: true,
    returnDetails: true,
  });
}

export async function recognizeOrderCustomsDeclaration(request: AuditRequestLike, actor: CustomsActor, orderId: string) {
  if (!["管理员", "财务", "业务员"].includes(actorRole(actor))) {
    throw permissionError("没有权限重新识别报关单信息", 403);
  }
  if (actor?.role === LOGISTICS_OPERATOR_ROLE) throw permissionError("物流供应商不能重新识别报关单信息");
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!before) throw permissionError("应收订单不存在或无权修改", 404);
  const document = await latestCustomsEntryDocument(orderId);
  if (!document) {
    throw codedError("未找到报关单文件，请先上传报关单。", 404, "CUSTOMS_DOCUMENT_NOT_FOUND");
  }
  const documentRuntime = customsDocumentRuntimeFields(document);
  if (!document.storageKey && !documentRuntime.filePath && !document.fileUrl) {
    throw codedError("文件不存在", 404, "CUSTOMS_FILE_NOT_FOUND");
  }

  let buffer: Buffer;
  try {
    buffer = await readCustomsDeclarationPdfBuffer(document);
  } catch (error: unknown) {
    const specificError = specificCustomsFileReadError(error);
    await applyCustomsParseFailure(request, actor, orderId, specificError.message, specificError.code, "重新识别失败", {
      allowManualFailure: true,
      publicMessage: specificError.message,
      technicalError: error,
      document,
    });
    throw specificError;
  }

  let parsed: ParseCustomsDocumentResult;
  try {
    parsed = await parseCustomsDocumentBuffer(buffer, document, { requireText: true });
  } catch (error: unknown) {
    const specificError = specificCustomsParseError(error);
    await applyCustomsParseFailure(request, actor, orderId, specificError.message, specificError.code, "重新识别失败", {
      allowManualFailure: true,
      publicMessage: specificError.message,
      technicalError: error,
      document,
    });
    throw specificError;
  }

  const { fields, source } = parsed;
  const missing = missingCustomsFieldMessages(fields);
  if (!hasCustomsRecognitionValue(fields)) {
    const message = missing.join("；") || "未识别到报关单号；未识别到申报日期";
    await applyCustomsParseFailure(request, actor, orderId, message, "CUSTOMS_FIELDS_NOT_FOUND", "重新识别失败", {
      allowManualFailure: true,
      clearFields: true,
      publicMessage: message,
      document,
    });
    throw codedError(message, 422, "CUSTOMS_FIELDS_NOT_FOUND");
  }

  const status = customsDeclarationParser.customsParseStatusFromFields(fields);
  const message = missing.length
    ? `已识别部分信息，${missing.join("；")}。`
    : (parsed.message || "识别成功");
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: customsUpdateData(fields, status, message, source),
    include: includeOrderRelations(),
  });
  await runNonCriticalTask("重新识别报关单日志写入", () => writeAudit(request, actor, status === "SUCCESS" ? "重新识别报关单信息" : "重新识别报关单部分信息", "receivable_orders", order.id, serializeCustomsRecognition(before), {
    ...serializeCustomsRecognition(order),
    documentId: document.id,
    uploadSource: customsDocumentRuntimeFields(document).uploadSource || "",
    recognitionSource: source,
  }));
  const notifiedOrder = await tryAutoShippingDocumentsNotification(request, actor, order.id);
  const serializedOrder = notifiedOrder || serializeOrder(order);
  return buildCustomsRecognitionResult({
    document,
    parsedFields: fields,
    currentFields: currentCustomsFields(before),
    status,
    message,
    applied: true,
    order: serializedOrder,
  });
}

export async function updateCustomsRecognition(request: AuditRequestLike, actor: CustomsActor, orderId: string, input: CustomsRecognitionInput = {}) {
  if (!["管理员", "财务", "业务员"].includes(actorRole(actor))) {
    throw permissionError("没有权限修改报关单识别信息", 403);
  }
  if (actor?.role === LOGISTICS_OPERATOR_ROLE) throw permissionError("物流供应商不能修改报关单识别字段");
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!before) throw permissionError("应收订单不存在或无权修改", 404);
  const fields = normalizeCustomsInput(input);
  const status = customsDeclarationParser.customsParseStatusFromFields(fields);
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: customsUpdateData(fields, status, "人工修改", customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL),
    include: includeOrderRelations(),
  });
  await runNonCriticalTask("报关单字段人工修改日志写入", () => writeAudit(request, actor, "手工修改申报日期/报关单号", "receivable_orders", order.id, serializeCustomsRecognition(before), serializeCustomsRecognition(order)));
  const notifiedOrder = await tryAutoShippingDocumentsNotification(request, actor, order.id);
  return notifiedOrder || serializeOrder(order);
}

export async function reparseCustomsRecognition(request: AuditRequestLike, actor: CustomsActor, orderId: string, input: CustomsRecognitionInput = {}) {
  if (!["管理员", "财务", "业务员"].includes(actorRole(actor))) {
    throw permissionError("没有权限修改报关单识别信息", 403);
  }
  if (actor?.role === LOGISTICS_OPERATOR_ROLE) throw permissionError("物流供应商不能重新识别报关单信息");
  const documentType = normalizeOrderDocumentType(nonEmpty(input.documentType || "CUSTOMS_ENTRY_FORM"));
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!order) throw permissionError("应收订单不存在或无权修改", 404);
  if (documentType && !isCustomsDeclarationDocumentType(documentType)) {
    const error = permissionError("仅支持 CUSTOMS_ENTRY_FORM 的报关单识别", 400);
    error.code = "INVALID_DOCUMENT_TYPE";
    throw error;
  }
  if ((order.customsDeclarationParseSource === "MANUAL" || order.customsParseStatus === "MANUAL") && input.confirmManualOverride !== true) {
    throw permissionError("当前报关单信息为人工修改状态，重新识别覆盖前需要二次确认。", 409);
  }
  const document = await resolveCustomsDeclarationDocument({
    orderId,
    documentId: nonEmpty(input.documentId),
    documentType,
  });
  if (!document) throw permissionError("未找到已上传成功的报关单 PDF", 404);
  let buffer: Buffer;
  try {
    buffer = await readCustomsDeclarationPdfBuffer(document);
  } catch (error: unknown) {
    return applyCustomsParseFailure(request, actor, orderId, CUSTOMS_FILE_READ_FAILED_MESSAGE, errorCode(error) || "CUSTOMS_PDF_READ_FAILED", "重新识别失败", {
      allowManualFailure: true,
      publicMessage: CUSTOMS_FILE_READ_FAILED_MESSAGE,
      technicalError: error,
      document,
    });
  }
  return parseAndApplyCustomsDocument(request, actor, document, buffer, {
    force: true,
    action: "重新识别并覆盖报关单信息",
    failureAction: "重新识别失败",
    allowManualFailure: true,
  });
}

export async function previewCustomsRecognition(actor: CustomsActor, orderId: string, input: CustomsRecognitionInput = {}) {
  if (!["管理员", "财务", "业务员"].includes(actorRole(actor))) {
    throw permissionError("没有权限修改报关单识别信息", 403);
  }
  if (actor?.role === LOGISTICS_OPERATOR_ROLE) throw permissionError("物流供应商不能重新识别报关单信息");
  const documentType = normalizeOrderDocumentType(nonEmpty(input.documentType || "CUSTOMS_ENTRY_FORM"));
  if (documentType && !isCustomsDeclarationDocumentType(documentType)) {
    const error = permissionError("仅支持 CUSTOMS_ENTRY_FORM 的报关单预览识别", 400);
    error.code = "INVALID_DOCUMENT_TYPE";
    throw error;
  }
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!order) throw permissionError("应收订单不存在或无权修改", 404);
  const document = await resolveCustomsDeclarationDocument({
    orderId,
    documentId: nonEmpty(input.documentId),
    documentType,
  });
  if (!document) throw permissionError("未找到已上传成功的报关单 PDF", 404);
  const buffer = await readCustomsDeclarationPdfBuffer(document);
  const { fields, source, status, message } = await parseCustomsDocumentBuffer(buffer, document);
  return {
    ...fields,
    orderId: order.id,
    documentId: document.id,
    source,
    status,
    message,
    currentStatus: order.customsParseStatus || "",
    currentStatusLabel: customsParseStatusLabel(order.customsParseStatus),
  };
}
