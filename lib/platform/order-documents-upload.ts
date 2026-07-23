import { prisma } from "../prisma";
import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import {
  parseCustomsDeclarationPdf,
  type CustomsDeclarationPdfTextParseResult,
} from "../pdf/parse-customs-declaration";
import { buildOrderDocumentKey, safeFileName } from "../r2";
import { tryAutoShippingDocumentsNotification } from "./shipping-documents";
import {
  ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA,
  ORDER_DOCUMENT_TYPES,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  codedError,
  dateFromInput,
  isCustomsDeclarationDocumentType,
  logServerError,
  nextStandardFilenameForUpload,
  normalizeOrderDocumentType,
  normalizeUploadSource,
  permissionError,
  deleteManagedStoredFile,
  FILE_ASSET_SOURCE_TABLES,
  readManagedUploadFile,
  refreshTaxRefundCompleteness,
  runNonCriticalTask,
  sanitizeForLog,
  serializeCustomsRecognition,
  serializeOrderDocument,
  softDeleteFileAssetBySource,
  scheduleTaxRefundCompletenessRefresh,
  invalidatePersistedTaxRefundCompleteness,
  syncCostInvoiceStatus,
  uploadManagedFileToStorage,
  upsertFileAssetForOrderDocument,
  writeAudit,
} from "./shared";
import {
  actorId,
  isLogisticsGeneratedCostInvoice,
  resolveDocumentScope,
  type ActorLike,
  type AuditRequestLike,
  type OrderDocumentUploadParams,
} from "./order-documents-types";
import { invalidateWorkbenchTodosCache } from "./workbench-todos-cache";

export async function uploadOrderDocument(request: AuditRequestLike, actor: ActorLike, { orderId, documentType, file, costId = "", supplierId = "", uploadSource = "" }: OrderDocumentUploadParams) {
  assertWrite(actor, "documents");
  const uploadedById = actorId(actor);
  const uploadInput = assertInputSchema(assertJsonObject({ orderId, documentType, costId, supplierId, uploadSource }), ORDER_DOCUMENT_UPLOAD_INPUT_SCHEMA);
  orderId = String(uploadInput.orderId || "");
  documentType = String(uploadInput.documentType || "");
  costId = String(uploadInput.costId || "");
  supplierId = String(uploadInput.supplierId || "");
  uploadSource = String(uploadInput.uploadSource || "");
  documentType = normalizeOrderDocumentType(documentType);
  if (!ORDER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) throw permissionError("请选择有效单证类型", 400);
  const { order, relatedModule, cost, supplierId: resolvedSupplierId } = await resolveDocumentScope({ orderId, documentType, costId, supplierId, uploadSource }, actor);
  if (isLogisticsGeneratedCostInvoice(documentType, cost)) {
    throw permissionError("物流费用发票请在物流费用模块按发票分组上传，成本管理仅同步查看。", 400);
  }
  const uploadedFile = await readManagedUploadFile(file, "pdf", "document.pdf");
  const { originalFileName, mimeType, body, fileSize } = uploadedFile;
  const standardFilename = await nextStandardFilenameForUpload(order, documentType, {
    cost,
    costId: cost?.id || "",
    supplierId: resolvedSupplierId || "",
    relatedModule,
  });
  const storageFileName = safeFileName(`${order.orderNo || order.id}_${documentType}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.pdf`);
  const storageKey = buildOrderDocumentKey({
    orderId: order.id,
    documentType,
    fileName: storageFileName,
    relatedModule,
    supplierId: resolvedSupplierId || "",
  });
  const storedFile = await uploadManagedFileToStorage({ file: uploadedFile, storageKey, fileName: standardFilename });
  let document;
  let replacedCustomsDocumentCount = 0;
  try {
    document = await prisma.$transaction(async (tx) => {
      const created = await tx.orderDocument.create({
        data: {
          orderId: order.id,
          costId: cost?.id || null,
          supplierId: resolvedSupplierId || null,
          relatedModule,
          documentType: documentType as OrderDocumentType,
          fileName: standardFilename,
          originalName: originalFileName,
          originalFilename: originalFileName,
          standardFilename,
          fileSize: storedFile.fileSize || fileSize,
          mimeType: storedFile.mimeType || mimeType,
          r2Bucket: storedFile.bucket,
          storageKey: storedFile.storageKey,
          fileUrl: storedFile.fileUrl,
          uploadStatus: "SUCCESS",
          uploadProgress: 100,
          uploadedById,
          uploadedAt: storedFile.uploadedAt,
        },
        include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
      });
      await upsertFileAssetForOrderDocument(tx, created);
      if (isCustomsDeclarationDocumentType(documentType)) {
        const replacedAt = new Date();
        const replacedDocuments = await tx.orderDocument.findMany({
          where: {
            orderId: order.id,
            documentType: "CUSTOMS_ENTRY_FORM",
            id: { not: created.id },
            deletedAt: null,
          },
          select: { id: true, documentType: true },
          take: 20,
        });
        const replaced = await tx.orderDocument.updateMany({
          where: {
            orderId: order.id,
            documentType: "CUSTOMS_ENTRY_FORM",
            id: { not: created.id },
            deletedAt: null,
          },
          data: { deletedAt: replacedAt },
        });
        for (const replacedDocument of replacedDocuments) {
          await softDeleteFileAssetBySource(
            tx,
            FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
            replacedDocument.id,
            String(replacedDocument.documentType),
            replacedAt,
          );
        }
        replacedCustomsDocumentCount = replaced.count || 0;
      }
      if (documentType === "EXPORT_INVOICE") {
        await invalidatePersistedTaxRefundCompleteness(tx, order.id);
      }
      return created;
    });
  } catch (error: unknown) {
    await deleteManagedStoredFile(storedFile.storageKey).catch(() => null);
    const message = error instanceof Error ? error.message : "未知错误";
    throw codedError(`数据库写入失败：${message}`, 500, "DATABASE_WRITE_FAILED");
  }
  if (documentType === "EXPORT_INVOICE") {
    try {
      await runNonCriticalTask("出口发票上传后退税完整度重算", async () => {
        const refreshed = await refreshTaxRefundCompleteness(order.id);
        if (!refreshed) throw new Error("出口发票已上传，但退税完整度重算未完成，将在下次读取时重试");
        return refreshed;
      }, { context: { orderId: order.id, documentId: document.id } }).catch((error) => {
        logServerError("出口发票上传后退税完整度重算任务异常", error, { orderId: order.id, documentId: document.id });
        return null;
      });
    } finally {
      invalidateWorkbenchTodosCache();
    }
  }
  await runNonCriticalTask("成本发票状态同步", () => syncCostInvoiceStatus(document.costId));
  const normalizedUploadSource = normalizeUploadSource(uploadSource, relatedModule);
  (document as typeof document & { uploadSource?: string }).uploadSource = normalizedUploadSource;
  let customsPdfTextParse: CustomsDeclarationPdfTextParseResult | null = null;
  const uploadAction = isCustomsDeclarationDocumentType(documentType) ? "报关单上传" : "上传文件";
  await runNonCriticalTask("文件上传操作日志写入", () => writeAudit(request, actor, uploadAction, "order_documents", document.id, null, {
    orderNo: order.orderNo,
    fileName: document.standardFilename || document.fileName,
    documentType,
    uploadSource: normalizedUploadSource,
    replacedCustomsDocumentCount,
  }));
  if (isCustomsDeclarationDocumentType(documentType)) {
    customsPdfTextParse = await parseAndApplyUploadedCustomsDeclarationPdf(request, actor, {
      orderId: order.id,
      orderNo: order.orderNo || "",
      documentId: document.id,
      fileName: document.standardFilename || document.fileName || originalFileName,
      pdfBody: body,
    });
  }
  if (["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_ENTRY_FORM"].includes(documentType)) {
    await tryAutoShippingDocumentsNotification(request, actor, order.id);
  }
  if (documentType !== "EXPORT_INVOICE") scheduleTaxRefundCompletenessRefresh(order.id);
  const serializedDocument = serializeOrderDocument(document) as ReturnType<typeof serializeOrderDocument> & {
    customsPdfTextParse?: CustomsDeclarationPdfTextParseResult;
  };
  if (customsPdfTextParse) serializedDocument.customsPdfTextParse = customsPdfTextParse;
  return serializedDocument;
}

async function parseAndApplyUploadedCustomsDeclarationPdf(
  request: AuditRequestLike,
  actor: ActorLike,
  input: {
    orderId: string;
    orderNo: string;
    documentId: string;
    fileName: string;
    pdfBody: Buffer | ArrayBuffer | Uint8Array | null | undefined;
  },
) {
  const startedAt = Date.now();
  try {
    const before = await prisma.receivableOrder.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        customsDeclarationNo: true,
        customsDeclarationDate: true,
        customsParsedAt: true,
        customsParseStatus: true,
        customsParseMessage: true,
        customsDeclarationParseSource: true,
      },
    });
    const parsed = await parseCustomsDeclarationPdf(input.pdfBody);
    const data: Prisma.ReceivableOrderUpdateInput = {
      customsParsedAt: new Date(),
      customsParseStatus: parsed.customsDeclarationParseStatus,
      customsParseMessage: parsed.customsDeclarationParseMessage,
      customsDeclarationParseSource: parsed.customsDeclarationParseSource,
      ...(parsed.customsDeclarationNo ? { customsDeclarationNo: parsed.customsDeclarationNo } : {}),
      ...(parsed.customsDeclarationDate ? { customsDeclarationDate: dateFromInput(parsed.customsDeclarationDate) } : {}),
    };
    const updated = await prisma.receivableOrder.update({
      where: { id: input.orderId },
      data,
      select: {
        id: true,
        customsDeclarationNo: true,
        customsDeclarationDate: true,
        customsParsedAt: true,
        customsParseStatus: true,
        customsParseMessage: true,
        customsDeclarationParseSource: true,
      },
    });
    console.info("customs-pdf-text-parse", sanitizeForLog({
      orderId: input.orderId,
      orderNo: input.orderNo,
      documentId: input.documentId,
      fileName: input.fileName,
      textLength: parsed.textLength,
      parsedDeclarationNo: parsed.customsDeclarationNo,
      parsedDeclarationDate: parsed.customsDeclarationDate,
      parseStatus: parsed.customsDeclarationParseStatus,
      parseFailedReason: parsed.parseFailedReason || "",
      durationMs: Date.now() - startedAt,
    }));
    await runNonCriticalTask("报关单PDF文本解析日志写入", () => writeAudit(
      request,
      actor,
      "报关单PDF文本解析",
      "receivable_orders",
      input.orderId,
      serializeCustomsRecognition(before || {}),
      {
        ...serializeCustomsRecognition(updated),
        documentId: input.documentId,
        fileName: input.fileName,
        textLength: parsed.textLength,
        parsedDeclarationNo: parsed.customsDeclarationNo,
        parsedDeclarationDate: parsed.customsDeclarationDate,
        parseFailedReason: parsed.parseFailedReason || "",
      },
    ), { context: { orderId: input.orderId, documentId: input.documentId } });
    return parsed;
  } catch (error) {
    logServerError("报关单PDF文本解析失败", error, {
      orderId: input.orderId,
      orderNo: input.orderNo,
      documentId: input.documentId,
      fileName: input.fileName,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
}
