import { prisma } from "../prisma";
import { runNonCriticalTask } from "./shared-constants";
import { codedError, nonEmpty } from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import { writeAudit } from "./shared-audit";
import {
  OCR_STATUS_MANUAL,
  OCR_STATUS_PASSED,
  OCR_STATUS_PROCESSING,
  OCR_STALE_PROCESSING_MESSAGE,
  VALIDATION_CONFIRMED,
  VALIDATION_FAILED,
  VALIDATION_REJECTED,
  type ActorLike,
  type AuditRequestLike,
  type OcrTaskRow,
  sanitizeSupplierOcrMessage,
  supplierOcrProcessingStaleMs,
} from "./supplier-document-ocr-shared";
import {
  assertInternalOcrManager,
  cancelProcessingSupplierDocumentOcrTasks,
  createSupplierDocumentOcrTask,
  loadSupplierReturnDocument,
  refreshSupplierDocumentRequestQualification,
  runSupplierDocumentOcrTaskWithTimeout,
  throwIfSupplierOcrTableMissing,
} from "./supplier-document-ocr-tasks";

export async function rerunSupplierDocumentOcr(request: AuditRequestLike, actor: ActorLike, requestId: string, documentId: string) {
  assertWrite(actor, "supplierDocuments");
  assertInternalOcrManager(actor);
  try {
    const document = await loadSupplierReturnDocument(documentId, requestId);
    const before = await prisma.ocrTask.findFirst({
      where: { documentId, requestId },
      orderBy: [{ createdAt: "desc" }],
    });
    await cancelProcessingSupplierDocumentOcrTasks(documentId, requestId);
    const task = await createSupplierDocumentOcrTask(document);
    if (!task) throw codedError("产品供应商资料回传 OCR 未启用，请到系统设置开启。", 403, "OCR_FEATURE_DISABLED");
    void runNonCriticalTask("资料回传OCR重新识别后台执行", async () => {
      const result = await runSupplierDocumentOcrTaskWithTimeout(task.id);
      await writeAudit(request, actor, "重新识别供应商回传资料", "ocr_tasks", task.id, before, result);
      return result;
    }, { context: { documentId, requestId, taskId: task.id, documentType: document.documentType }, slowMs: 3000 });
    return serializeSupplierDocumentOcrTask(task);
  } catch (error: unknown) {
    throwIfSupplierOcrTableMissing(error);
    throw error;
  }
}

export async function confirmSupplierDocumentOcr(request: AuditRequestLike, actor: ActorLike, requestId: string, documentId: string) {
  assertWrite(actor, "supplierDocuments");
  assertInternalOcrManager(actor);
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
  await refreshSupplierDocumentRequestQualification(requestId, { completedById: actor?.id || null });
  await runNonCriticalTask("资料回传OCR人工确认日志写入", () => writeAudit(request, actor, "人工确认供应商回传资料OCR", "ocr_tasks", saved.id, before, saved));
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
  await runNonCriticalTask("资料回传OCR驳回日志写入", () => writeAudit(request, actor, "驳回供应商回传资料OCR", "ocr_tasks", saved.id, before, saved));
  return serializeSupplierDocumentOcrTask(saved);
}

export function serializeSupplierDocumentOcrTask(task: OcrTaskRow | null | undefined) {
  if (!task) return null;
  const staleProcessing = (
    task.status === OCR_STATUS_PROCESSING
    || task.validationStatus === "PROCESSING"
  ) && Date.now() - new Date(task.createdAt).getTime() > supplierOcrProcessingStaleMs();
  const serializedStatus = staleProcessing ? "OCR识别失败，需人工核对" : task.status;
  const serializedValidationStatus = staleProcessing ? VALIDATION_FAILED : (task.validationStatus || "");
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
  const errorMessage = staleProcessing ? OCR_STALE_PROCESSING_MESSAGE : sanitizeSupplierOcrMessage(task.errorMessage, "");
  const issues = persistedIssues.length
    ? persistedIssues
    : staleProcessing
      ? [{ level: "manual", message: OCR_STALE_PROCESSING_MESSAGE, field: "" }]
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
    status: serializedStatus,
    validationStatus: serializedValidationStatus,
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
