import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { logisticsInvoiceGroupForExpense } from "./logistics-invoice-groups";
import {
  codedError,
  nonEmpty,
} from "./shared";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_INVOICE_OCR_MODULE,
  LOGISTICS_INVOICE_VALIDATION_PROCESSING,
  LOGISTICS_INVOICE_VALIDATION_PASSED,
  LOGISTICS_INVOICE_VALIDATION_FAILED,
  LOGISTICS_INVOICE_OCR_TIMEOUT_MESSAGE,
  DEFAULT_LOGISTICS_INVOICE_OCR_TASK_TIMEOUT_MS,
  asRecord,
  logisticsOcrErrorMessage,
  validationRowIds,
} from "./logistics-invoice-validation-model";
import { recognizeAndValidateLogisticsInvoiceGroup } from "./logistics-invoice-validation-recognition";

export async function runLogisticsInvoiceOcrTask(taskId: string) {
  const task = await prisma.ocrTask.findUnique({ where: { id: taskId } });
  if (!task) throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
  if (task.module !== LOGISTICS_INVOICE_OCR_MODULE) {
    throw codedError("该 OCR 任务不是物流发票识别任务。", 400, "LOGISTICS_INVOICE_OCR_TASK_MODULE_INVALID");
  }
  const validation = asRecord(task.validationJson);
  const rowIds = Array.isArray(validation.rowIds)
    ? validation.rowIds.map((item) => String(item || "")).filter(Boolean)
    : [];
  const rows = await prisma.logisticsExpense.findMany({
    where: {
      deletedAt: null,
      ...(rowIds.length
        ? { id: { in: rowIds }, invoiceDocumentId: task.documentId }
        : { invoiceDocumentId: task.documentId }),
    },
    select: {
      id: true,
      orderId: true,
      supplierId: true,
      costType: true,
      currency: true,
      amount: true,
      invoiceDocumentId: true,
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const mappedRows = rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    supplierId: row.supplierId,
    costType: row.costType,
    currency: row.currency,
    amount: row.amount,
    invoiceDocumentId: row.invoiceDocumentId,
  }));
  const invoiceGroupKey = nonEmpty(validation.invoiceGroupKey) || logisticsInvoiceGroupForExpense(mappedRows[0])?.key || "";
  if (!mappedRows.length || !invoiceGroupKey) {
    await prisma.ocrTask.update({
      where: { id: task.id },
      data: {
        status: LOGISTICS_INVOICE_VALIDATION_FAILED,
        validationStatus: "FAILED",
        errorMessage: "未找到物流发票对应的费用分组。",
      },
    });
    throw codedError("未找到物流发票对应的费用分组。", 404, "LOGISTICS_INVOICE_OCR_ROWS_NOT_FOUND");
  }
  return recognizeAndValidateLogisticsInvoiceGroup({
    documentId: task.documentId,
    invoiceGroupKey,
    rows: mappedRows,
    actor: null,
    taskId: task.id,
  });
}

async function markLogisticsInvoiceOcrTaskFailed(taskId: string, error: unknown, parserStatus = "物流发票识别失败") {
  const current = await prisma.ocrTask.findUnique({ where: { id: taskId }, include: { results: true } });
  if (!current) throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
  const message = logisticsOcrErrorMessage(error).slice(0, 1000);
  const validation = asRecord(current.validationJson);
  const rowIds = validationRowIds(current.validationJson);
  const validationJson = {
    ...validation,
    issues: [{ level: "manual", message }],
    parserStatus,
  };
  const updated = await prisma.ocrTask.updateMany({
    where: {
      id: taskId,
      module: LOGISTICS_INVOICE_OCR_MODULE,
      status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      validationStatus: "PROCESSING",
    },
    data: {
      status: LOGISTICS_INVOICE_VALIDATION_FAILED,
      validationStatus: "FAILED",
      errorMessage: message,
      validationJson: validationJson as Prisma.InputJsonValue,
    },
  });
  if (updated.count && rowIds.length) {
    await prisma.logisticsExpense.updateMany({
      where: {
        id: { in: rowIds },
        deletedAt: null,
        invoiceOcrTaskId: taskId,
        invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      },
      data: {
        invoiceValidationStatus: LOGISTICS_INVOICE_VALIDATION_FAILED,
        invoiceValidationMessage: message,
        invoiceValidationJson: validationJson as Prisma.InputJsonValue,
      },
    });
  }
  const saved = await prisma.ocrTask.findUnique({ where: { id: taskId }, include: { results: true } });
  if (!saved) throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
  if (!updated.count) {
    console.info("logistics-invoice-ocr-late-failure-ignored", {
      taskId,
      status: saved.status,
      validationStatus: saved.validationStatus,
      documentId: saved.documentId,
    });
  }
  invalidateWorkbenchTodosCache();
  return saved;
}

export async function runLogisticsInvoiceOcrTaskWithTimeout(taskId: string, timeoutMs = DEFAULT_LOGISTICS_INVOICE_OCR_TASK_TIMEOUT_MS) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runLogisticsInvoiceOcrTask(taskId),
      new Promise<Awaited<ReturnType<typeof runLogisticsInvoiceOcrTask>>>((_, reject) => {
        timeout = setTimeout(() => {
          reject(codedError(LOGISTICS_INVOICE_OCR_TIMEOUT_MESSAGE, 504, "LOGISTICS_INVOICE_OCR_TASK_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "LOGISTICS_INVOICE_OCR_TASK_TIMEOUT") {
      console.error("logistics-invoice-ocr-timeout", { taskId, timeoutMs });
      return markLogisticsInvoiceOcrTaskFailed(taskId, error, "物流发票识别超时");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function logisticsInvoiceOcrApiResult(ocrTask: Awaited<ReturnType<typeof runLogisticsInvoiceOcrTaskWithTimeout>> | null | undefined) {
  const validationStatus = String(ocrTask?.validationStatus || "");
  const statusText = String(ocrTask?.status || "");
  const validationJson = ocrTask?.validationJson && typeof ocrTask.validationJson === "object" && !Array.isArray(ocrTask.validationJson)
    ? ocrTask.validationJson as Record<string, unknown>
    : {};
  const issues = Array.isArray(validationJson.issues)
    ? validationJson.issues.map((issue) => asRecord(issue)).map((issue) => String(issue.message || "")).filter(Boolean)
    : [];
  const errorMessage = String(ocrTask?.errorMessage || issues[0] || "");
  const timeout = /超时|TIMEOUT/i.test([errorMessage, ...issues].join(" "));
  if (timeout) {
    return {
      status: "TIMEOUT",
      message: LOGISTICS_INVOICE_OCR_TIMEOUT_MESSAGE,
      result: ocrTask,
      error: errorMessage || "OCR识别超时",
    };
  }
  if (validationStatus === "PASSED" || statusText === LOGISTICS_INVOICE_VALIDATION_PASSED) {
    return {
      status: "PASSED",
      message: "OCR校验通过",
      result: ocrTask,
    };
  }
  if (validationStatus === "FAILED" || statusText === LOGISTICS_INVOICE_VALIDATION_FAILED || !ocrTask) {
    return {
      status: "FAILED",
      message: "OCR识别失败，请人工核对或重新上传",
      result: ocrTask,
      error: errorMessage || "具体失败原因未返回",
    };
  }
  return {
    status: "NEEDS_REVIEW",
    message: "OCR已识别，但部分字段需人工确认",
    result: ocrTask,
    error: errorMessage || "",
  };
}

export async function runPendingLogisticsInvoiceOcrTasks(limit = 5, minAgeMs = 60_000) {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 5), 1), 20);
  const readyBefore = new Date(Date.now() - Math.max(Math.trunc(Number(minAgeMs) || 60_000), 15_000));
  const tasks = await prisma.ocrTask.findMany({
    where: {
      module: LOGISTICS_INVOICE_OCR_MODULE,
      status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
      validationStatus: "PROCESSING",
      updatedAt: { lt: readyBefore },
    },
    select: { id: true, documentId: true, orderId: true, supplierId: true, documentType: true, updatedAt: true },
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
          status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
          validationStatus: "PROCESSING",
          updatedAt: { lte: task.updatedAt },
        },
        data: { updatedAt: new Date(), errorMessage: null },
      });
      if (!claimed.count) {
        result.skipped += 1;
        continue;
      }
      const completed = await runLogisticsInvoiceOcrTaskWithTimeout(task.id);
      if (
        !completed
        || completed.validationStatus === "FAILED"
        || completed.status === LOGISTICS_INVOICE_VALIDATION_FAILED
      ) {
        result.failed += 1;
      } else {
        result.processed += 1;
      }
    } catch (error) {
      result.failed += 1;
      const message = logisticsOcrErrorMessage(error, "物流发票识别失败");
      await markLogisticsInvoiceOcrTaskFailed(task.id, error, "物流发票后台识别失败").catch(() => null);
      console.error("logistics-invoice-ocr-pending-worker-failed", {
        taskId: task.id,
        documentId: task.documentId,
        orderId: task.orderId,
        supplierId: task.supplierId,
        documentType: task.documentType,
        message,
      });
    }
  }
  if (tasks.length) {
    console.info("logistics-invoice-ocr-pending-worker", result);
  }
  return result;
}
