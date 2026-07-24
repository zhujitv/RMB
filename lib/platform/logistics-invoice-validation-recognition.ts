import { readR2Object } from "../r2";
import { prisma } from "../prisma";
import { recognizeLogisticsInvoiceWithOcr } from "./ocr-integration";
import {
  parseVatInvoiceFields,
  vatInvoiceParserIssues,
  vatInvoiceResultLabels,
  visibleResultFields,
} from "./vat-invoice-ocr-shared";
import { getLogisticsInvoiceValidationRules } from "./logistics-invoice-validation-rules";
import { logisticsInvoiceGroupForKey } from "./logistics-invoice-groups";
import {
  codedError,
  nonEmpty,
} from "./shared";
import { DEFAULT_COMPANY_PROFILE_SETTINGS } from "./shared-constants";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";
import {
  LOGISTICS_INVOICE_OCR_MODULE,
  LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
  LOGISTICS_INVOICE_VALIDATION_PROCESSING,
  LOGISTICS_INVOICE_VALIDATION_FAILED,
  type ActorLike,
  type LogisticsInvoiceValidationRow,
  cleanText,
  issueMessage,
} from "./logistics-invoice-validation-model";
import {
  updateRowsWithValidationResult,
} from "./logistics-invoice-validation-tasks";
import {
  validateLogisticsInvoiceFields,
  validationStatusFromIssues,
  mergeValidationIssues,
} from "./logistics-invoice-validation-rules-engine";
import {
  persistLogisticsInvoiceRecognitionFailure,
  persistLogisticsInvoiceRecognitionSuccess,
} from "./logistics-invoice-validation-persistence";

export async function recognizeAndValidateLogisticsInvoiceGroup(input: {
  documentId: string;
  invoiceGroupKey: string;
  rows: LogisticsInvoiceValidationRow[];
  actor: ActorLike;
  taskId?: string;
}) {
  const rows = input.rows.filter((row) => row.id);
  const rowIds = rows.map((row) => row.id);
  const documentId = nonEmpty(input.documentId);
  const invoiceGroup = logisticsInvoiceGroupForKey(input.invoiceGroupKey);
  if (!documentId || !rowIds.length || !invoiceGroup) return null;
  const document = await prisma.orderDocument.findFirst({
    where: { id: documentId, deletedAt: null },
    include: { order: { include: { businessEntity: true } }, supplier: true, cost: true },
  });
  if (!document || !document.storageKey) {
    await updateRowsWithValidationResult({
      rowIds,
      actor: input.actor,
      status: LOGISTICS_INVOICE_VALIDATION_FAILED,
      message: "发票文件不存在或无法读取。",
      validationJson: { documentId, invoiceGroupKey: input.invoiceGroupKey },
    });
    return null;
  }
  const task = input.taskId
    ? await (async () => {
        const claimed = await prisma.ocrTask.updateMany({
          where: {
            id: input.taskId,
            module: LOGISTICS_INVOICE_OCR_MODULE,
            status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
            validationStatus: "PROCESSING",
          },
          data: {
            errorMessage: null,
            validationJson: {
              documentId,
              invoiceGroupKey: invoiceGroup.key,
              rowIds,
            },
          },
        });
        const current = await prisma.ocrTask.findUnique({ where: { id: input.taskId }, include: { results: true } });
        if (!current) throw codedError("物流发票识别任务不存在。", 404, "LOGISTICS_INVOICE_OCR_TASK_NOT_FOUND");
        if (!claimed.count) {
          console.info("logistics-invoice-ocr-run-skipped-non-processing", {
            taskId: input.taskId,
            status: current.status,
            validationStatus: current.validationStatus,
            documentId,
            invoiceGroupKey: invoiceGroup.key,
          });
          return current;
        }
        return current;
      })()
    : await prisma.ocrTask.create({
        data: {
          module: LOGISTICS_INVOICE_OCR_MODULE,
          documentId,
          orderId: document.orderId,
          supplierId: document.supplierId,
          documentType: LOGISTICS_INVOICE_OCR_DOCUMENT_TYPE,
          status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
          validationStatus: "PROCESSING",
          validationJson: {
            documentId,
            invoiceGroupKey: invoiceGroup.key,
            rowIds,
          },
        },
        include: { results: true },
      });
  if (task.status !== LOGISTICS_INVOICE_VALIDATION_PROCESSING || task.validationStatus !== "PROCESSING") return task;
  await updateRowsWithValidationResult({
    rowIds,
    actor: input.actor,
    status: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
    message: "",
    validationJson: { documentId, invoiceGroupKey: input.invoiceGroupKey, rowIds },
    taskId: task.id,
    expectedTaskId: task.id,
    expectedStatus: LOGISTICS_INVOICE_VALIDATION_PROCESSING,
  });
  let latestRawText = "";
  let latestRawJson: unknown = null;
  let latestApiName = "";
  let latestProvider = "ALIYUN";
  try {
    const fileBuffer = await readR2Object(document.storageKey);
    const recognized = await recognizeLogisticsInvoiceWithOcr(fileBuffer);
    const text = cleanText(recognized.text);
    const structuredFields = recognized.extractedFields || {};
    latestRawText = text;
    latestRawJson = recognized.rawJson || { source: recognized.source, provider: recognized.provider, textLength: text.length };
    latestApiName = recognized.apiName || recognized.source || "ALIYUN_RECOGNIZE_INVOICE";
    latestProvider = recognized.provider || "ALIYUN";
    const fields = parseVatInvoiceFields(text, structuredFields);
    const expectedSellerName = nonEmpty(document.supplier?.invoiceTitle || document.supplier?.supplierName);
    const expectedBuyerName = nonEmpty(
      document.order.businessEntity?.name
      || document.order.businessEntityNameSnapshot
      || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh,
    );
    const rules = await getLogisticsInvoiceValidationRules();
    const validation = validateLogisticsInvoiceFields({
      fields,
      rawText: text,
      rows,
      invoiceGroup,
      keywords: rules[invoiceGroup.key]?.keywords || [],
      expectedSellerName,
      expectedBuyerName,
    });
    const parserIssues = vatInvoiceParserIssues(fields).filter((issue) => ["productName", "seller", "buyer"].includes(issue.field || ""));
    const issues = mergeValidationIssues(validation.issues, parserIssues);
    const status = validationStatusFromIssues(issues, validation.status);
    const message = issueMessage(issues);
    const fieldRows = visibleResultFields(
      fields as unknown as Record<string, unknown>,
      vatInvoiceResultLabels(),
    );
    const validationJson = {
      invoiceGroupKey: invoiceGroup.key,
      invoiceGroupLabel: invoiceGroup.label,
      systemAmount: validation.expectedAmount,
      systemCurrency: validation.currency,
      recognizedAmount: validation.recognizedAmount,
      recognizedAmountSource: validation.recognizedAmountSource,
      taxInvoiceAmount: validation.taxInvoiceAmount,
      recognizedName: fields.productName || "",
      expectedSellerName,
      recognizedSeller: fields.seller || "",
      expectedBuyerName,
      recognizedBuyer: fields.buyer || "",
      allowedKeywords: rules[invoiceGroup.key]?.keywords || [],
      issues,
      fields,
      structuredFields,
      source: recognized.source,
      provider: recognized.provider,
    };
    const saved = await persistLogisticsInvoiceRecognitionSuccess({
      taskId: task.id,
      documentId,
      documentOrderId: document.orderId,
      rowIds,
      actorId: input.actor?.id || null,
      status,
      message,
      text,
      fields,
      validationJson,
      recognizedAmount: validation.recognizedAmount,
      fieldRows,
      rawJson: latestRawJson,
      provider: latestProvider,
      apiName: latestApiName,
      structuredFields,
      parser: recognized.parser || "VAT_INVOICE",
      confidence: recognized.confidence ?? null,
    });
    console.info("logistics-invoice-validation-complete", {
      documentId,
      taskId: task.id,
      invoiceGroupKey: invoiceGroup.key,
      status,
      systemAmount: validation.expectedAmount,
      recognizedAmount: validation.recognizedAmount,
      recognizedName: fields.productName || "",
      rowIds,
    });
    invalidateWorkbenchTodosCache();
    return saved;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "识别失败");
    const validationJson = {
      invoiceGroupKey: input.invoiceGroupKey,
      documentId,
      issues: [{ level: "error", message }],
      rawText: latestRawText,
      provider: latestProvider,
      apiName: latestApiName || "LOGISTICS_INVOICE_OCR",
    };
    const saved = await persistLogisticsInvoiceRecognitionFailure({
      taskId: task.id,
      documentId,
      documentOrderId: document.orderId,
      rowIds,
      actorId: input.actor?.id || null,
      message,
      validationJson,
      rawText: latestRawText,
      rawJson: latestRawJson,
      provider: latestProvider,
      apiName: latestApiName || "LOGISTICS_INVOICE_OCR",
    });
    console.error("logistics-invoice-validation-failed", {
      documentId,
      taskId: task.id,
      invoiceGroupKey: input.invoiceGroupKey,
      rowIds,
      message,
    });
    invalidateWorkbenchTodosCache();
    return saved;
  }
}
