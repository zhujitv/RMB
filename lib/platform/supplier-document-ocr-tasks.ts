import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { readR2Object } from "../r2";
import { prisma } from "../prisma";
import { logServerError, codedError } from "./shared-base-utils";
import { ORDER_COST_STATUS_VOID } from "./shared-cost-constants";
import { isProductSupplierOperatorRole } from "./shared-constants";
import { assertRead } from "./shared-auth";
import { isOcrFeatureEnabled, recognizeSupplierDocumentWithOcr } from "./ocr-integration";
import { saveOcrRawResult } from "./ocr-raw-results";
import { refreshSupplierDocumentRequestCompletion, type CompletionRefreshOptions } from "./supplier-document-request-completion";
import {
  INTERNAL_OCR_ROLES,
  OCR_STATUS_FAILED,
  OCR_STATUS_PROCESSING,
  OCR_RERUN_CANCELLED_MESSAGE,
  OCR_STALE_PROCESSING_MESSAGE,
  SUPPLIER_DOCUMENT_OCR_FEATURE,
  SUPPLIER_DOCUMENT_OCR_MODULE,
  SUPPLIER_DOCUMENT_OCR_TYPES,
  VALIDATION_FAILED,
  VALIDATION_PASSED,
  type ActorLike,
  type OcrDocumentRow,
  type OcrTaskRow,
  cleanText,
  parseContractFields,
  parseVatInvoiceFields,
  sanitizeSupplierOcrMessage,
  shortRawText,
  supplierDocumentLabels,
  supplierDocumentOcrFailureKind,
  supplierDocumentOcrFailureMessage,
  supplierOcrFailureTechnicalDetails,
  supplierOcrErrorText,
  supplierOcrTaskTimeoutMs,
  supplierOcrProcessingStaleMs,
  visibleResultFields,
} from "./supplier-document-ocr-shared";
import {
  enrichVatInvoiceFields,
  invoiceParserIssues,
  ocrValidationContext,
  taskStatusFromIssues,
  validateContract,
  validateInvoice,
} from "./supplier-document-ocr-validation";

export async function reconcileStaleSupplierDocumentOcrTasks(documentIds: string[] = []) {
  const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))];
  if (!uniqueDocumentIds.length) return 0;
  const staleBefore = new Date(Date.now() - supplierOcrProcessingStaleMs());
  try {
    const staleTasks = await prisma.ocrTask.findMany({
      where: {
        module: SUPPLIER_DOCUMENT_OCR_MODULE,
        documentId: { in: uniqueDocumentIds },
        AND: [
          {
            OR: [
              { status: OCR_STATUS_PROCESSING },
              { validationStatus: "PROCESSING" },
            ],
          },
          {
            OR: [
              { updatedAt: { lt: staleBefore } },
              { createdAt: { lt: staleBefore } },
            ],
          },
        ],
      },
      select: { id: true, documentId: true, requestId: true, createdAt: true, updatedAt: true },
      take: Math.min(Math.max(uniqueDocumentIds.length * 2, 20), 500),
    });
    if (!staleTasks.length) return 0;
    const ids = staleTasks.map((task) => task.id);
    await prisma.ocrTask.updateMany({
      where: { id: { in: ids } },
      data: {
        status: OCR_STATUS_FAILED,
        validationStatus: VALIDATION_FAILED,
        errorMessage: OCR_STALE_PROCESSING_MESSAGE,
        validationJson: {
          issues: [{ level: "manual", message: OCR_STALE_PROCESSING_MESSAGE }],
          parserStatus: "OCR后台任务超时",
          failureKind: "TIMEOUT",
          technicalError: "Supplier document OCR task stayed PROCESSING beyond the stale threshold.",
          errorCode: "SUPPLIER_DOCUMENT_OCR_STALE_TIMEOUT",
        },
      },
    });
    console.warn("supplier-document-ocr-stale-processing-reconciled", {
      count: staleTasks.length,
      documentIds: staleTasks.map((task) => task.documentId),
      requestIds: staleTasks.map((task) => task.requestId).filter(Boolean),
      staleBefore: staleBefore.toISOString(),
      createdAt: staleTasks.map((task) => task.createdAt),
    });
    return staleTasks.length;
  } catch (error) {
    throwIfSupplierOcrTableMissing(error);
    logServerError("供应商资料回传OCR处理中任务自愈失败", error, { documentCount: uniqueDocumentIds.length });
    return 0;
  }
}

export async function cancelProcessingSupplierDocumentOcrTasks(documentId: string, requestId = "", reason = OCR_RERUN_CANCELLED_MESSAGE) {
  if (!documentId) return 0;
  const updated = await prisma.ocrTask.updateMany({
    where: {
      module: SUPPLIER_DOCUMENT_OCR_MODULE,
      documentId,
      ...(requestId ? { requestId } : {}),
      OR: [
        { status: OCR_STATUS_PROCESSING },
        { validationStatus: "PROCESSING" },
      ],
    },
    data: {
      status: OCR_STATUS_FAILED,
      validationStatus: VALIDATION_FAILED,
      errorMessage: reason,
      validationJson: {
        issues: [{ level: "manual", message: reason }],
        parserStatus: "OCR任务已取消",
      },
    },
  });
  if (updated.count) {
    console.info("supplier-document-ocr-processing-cancelled", { documentId, requestId, count: updated.count });
  }
  return updated.count;
}

async function markSupplierDocumentOcrTaskFailed(taskId: string, error: unknown, parserStatus = "OCR后台任务执行失败") {
  const task = await prisma.ocrTask.findUnique({
    where: { id: taskId },
    select: { id: true, requestId: true, documentId: true, orderId: true, documentType: true },
  });
  const originalMessage = supplierOcrErrorText(error);
  const message = supplierDocumentOcrFailureMessage(error);
  const failureKind = supplierDocumentOcrFailureKind(error);
  const technicalDetails = supplierOcrFailureTechnicalDetails(error);
  const saved = await prisma.ocrTask.update({
    where: { id: taskId },
    data: {
      status: OCR_STATUS_FAILED,
      validationStatus: VALIDATION_FAILED,
      errorMessage: message.slice(0, 1000),
      validationJson: {
        issues: [{ level: "manual", message }],
        parserStatus,
        failureKind,
        technicalError: originalMessage.slice(0, 1000),
        provider: technicalDetails.provider,
        apiName: technicalDetails.apiName,
        requestId: technicalDetails.requestId,
        httpStatus: technicalDetails.httpStatus,
        errorCode: technicalDetails.errorCode,
        errorMessage: technicalDetails.errorMessage,
        responseBody: technicalDetails.responseBody,
      },
    },
    include: { results: true },
  });
  if (task?.requestId) {
    await refreshSupplierDocumentRequestQualification(task.requestId).catch((refreshError) => {
      logServerError("供应商资料回传OCR失败后完成度刷新失败", refreshError, {
        taskId,
        requestId: task.requestId,
        documentId: task.documentId,
      });
    });
  }
  return saved;
}

export async function runSupplierDocumentOcrTaskWithTimeout(taskId: string, timeoutMs = supplierOcrTaskTimeoutMs()) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runSupplierDocumentOcrTask(taskId),
      new Promise<OcrTaskRow>((_, reject) => {
        timeout = setTimeout(() => {
          reject(codedError(OCR_STALE_PROCESSING_MESSAGE, 504, "SUPPLIER_DOCUMENT_OCR_TASK_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "SUPPLIER_DOCUMENT_OCR_TASK_TIMEOUT") {
      const saved = await markSupplierDocumentOcrTaskFailed(taskId, error, "OCR后台任务执行超时");
      logServerError("供应商资料回传OCR后台任务超时", error, {
        taskId,
        timeoutMs,
        failureKind: supplierDocumentOcrFailureKind(error),
        technicalDetails: supplierOcrFailureTechnicalDetails(error),
        documentId: saved.documentId,
        requestId: saved.requestId || "",
      });
      return saved;
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runPendingSupplierDocumentOcrTasks(limit = 5, minAgeMs = 60_000) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 5), 1), 20);
  const readyBefore = new Date(Date.now() - Math.max(Math.trunc(Number(minAgeMs) || 60_000), 15_000));
  const tasks = await prisma.ocrTask.findMany({
    where: {
      module: SUPPLIER_DOCUMENT_OCR_MODULE,
      status: OCR_STATUS_PROCESSING,
      validationStatus: "PROCESSING",
      updatedAt: { lt: readyBefore },
    },
    select: { id: true, documentId: true, requestId: true, orderId: true, documentType: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: safeLimit,
  });
  const result = {
    scanned: tasks.length,
    processed: 0,
    failed: 0,
    skipped: 0,
    taskIds: tasks.map((task) => task.id),
  };
  for (const task of tasks) {
    try {
      const claimed = await prisma.ocrTask.updateMany({
        where: {
          id: task.id,
          status: OCR_STATUS_PROCESSING,
          validationStatus: "PROCESSING",
          updatedAt: { lte: task.updatedAt },
        },
        data: {
          updatedAt: new Date(),
          errorMessage: null,
        },
      });
      if (!claimed.count) {
        result.skipped += 1;
        continue;
      }
      await runSupplierDocumentOcrTaskWithTimeout(task.id);
      result.processed += 1;
    } catch (error) {
      result.failed += 1;
      await markSupplierDocumentOcrTaskFailed(task.id, error).catch((updateError) => {
        logServerError("供应商资料回传OCR后台任务失败状态回写失败", updateError, { taskId: task.id });
      });
      logServerError("供应商资料回传OCR后台任务执行失败", error, {
        taskId: task.id,
        documentId: task.documentId,
        requestId: task.requestId,
        orderId: task.orderId,
        documentType: task.documentType,
        failureKind: supplierDocumentOcrFailureKind(error),
        technicalDetails: supplierOcrFailureTechnicalDetails(error),
      });
    }
  }
  if (tasks.length) {
    console.info("supplier-document-ocr-pending-worker", result);
  }
  return result;
}

export function assertInternalOcrManager(actor: ActorLike) {
  if (!actor?.id || !INTERNAL_OCR_ROLES.includes(String(actor.role || ""))) {
    throw codedError("没有权限处理 OCR 校验结果。", 403, "OCR_MANAGE_PERMISSION_DENIED");
  }
}

export function normalizeSupplierReturnDocumentType(value: unknown) {
  const type = String(value || "").trim().toUpperCase();
  if (["SUPPLIER_PURCHASE_CONTRACT", "PURCHASE_CONTRACT", "FACTORY_PURCHASE_CONTRACT", "FACTORY_CONTRACT"].includes(type)) {
    return "SUPPLIER_PURCHASE_CONTRACT";
  }
  if (["SUPPLIER_INVOICE", "VAT_INVOICE", "SUPPLIER_VAT_INVOICE", "FACTORY_INVOICE", "FACTORY_VAT_INVOICE"].includes(type)) {
    return "SUPPLIER_INVOICE";
  }
  return type;
}

export function isSupplierOcrTableMissingError(error: unknown) {
  const typedError = (error || {}) as { code?: string; meta?: { table?: unknown; modelName?: unknown }; message?: string };
  const haystack = [
    typedError.code,
    typedError.meta?.table,
    typedError.meta?.modelName,
    typedError.message,
  ].map((value) => String(value || "")).join(" ");
  return typedError.code === "P2021" && /ocr_tasks|ocr_results|OcrTask|OcrResult/i.test(haystack);
}

export function supplierOcrTableName(error: unknown) {
  const typedError = (error || {}) as { meta?: { table?: unknown; modelName?: unknown }; message?: string };
  const explicit = String(typedError.meta?.table || typedError.meta?.modelName || "").trim();
  if (explicit) return explicit;
  const match = String(typedError.message || "").match(/ocr_(?:tasks|results)|OcrTask|OcrResult/i);
  return match?.[0] || "";
}

export function throwIfSupplierOcrTableMissing(error: unknown): never | void {
  if (!isSupplierOcrTableMissingError(error)) return;
  const table = supplierOcrTableName(error);
  throw codedError(
    `OCR 数据表未初始化，请联系管理员执行数据库迁移${table ? `（缺少 ${table}）` : ""}。`,
    503,
    "OCR_TABLE_NOT_INITIALIZED",
  );
}

export async function loadSupplierReturnDocument(documentId: string, requestId = "", actor: ActorLike = null): Promise<OcrDocumentRow> {
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
          order: {
            include: {
              businessEntity: true,
              costs: { where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID } }, include: { supplier: true } },
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
  if (isProductSupplierOperatorRole(actor?.role) && document.supplierId !== actor?.supplierId) {
    throw codedError("回传资料文件不存在或无权限访问。", 404, "SUPPLIER_DOCUMENT_NOT_FOUND");
  }
  if (!document.storageKey) {
    throw codedError("文件记录存在，但文件地址无法访问。", 404, "SUPPLIER_DOCUMENT_FILE_MISSING");
  }
  if (document.uploadStatus && document.uploadStatus !== "SUCCESS") {
    throw codedError("文件尚未上传完成，不能进行 OCR 识别。", 400, "SUPPLIER_DOCUMENT_UPLOAD_INCOMPLETE");
  }
  return document;
}

export async function createSupplierDocumentOcrTask(document: OcrDocumentRow) {
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
  }
  const document = await loadSupplierReturnDocument(documentId, options.requestId || "", actor);
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
    if (document.factoryDocumentRequestId) {
      await refreshSupplierDocumentRequestQualification(document.factoryDocumentRequestId);
    }
    return saved;
  } catch (error) {
    throwIfSupplierOcrTableMissing(error);
    const originalMessage = supplierOcrErrorText(error);
    const message = supplierDocumentOcrFailureMessage(error);
    const failureKind = supplierDocumentOcrFailureKind(error);
    const technicalDetails = supplierOcrFailureTechnicalDetails(error);
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
            failureKind,
            technicalError: originalMessage.slice(0, 1000),
            provider: latestProvider,
            apiName: latestApiName || "SUPPLIER_DOCUMENT_OCR",
            requestId: technicalDetails.requestId,
            httpStatus: technicalDetails.httpStatus,
            errorCode: technicalDetails.errorCode,
            errorMessage: technicalDetails.errorMessage,
            responseBody: technicalDetails.responseBody,
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
    logServerError("产品供应商回传资料OCR识别失败", error, {
      documentId,
      taskId: task.id,
      requestId: document.factoryDocumentRequestId || "",
      orderId: document.orderId || "",
      documentType: document.documentType,
      failureKind,
      technicalDetails,
    });
    if (document.factoryDocumentRequestId) {
      await refreshSupplierDocumentRequestQualification(document.factoryDocumentRequestId);
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
