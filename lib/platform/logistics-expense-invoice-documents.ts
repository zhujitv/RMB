import { prisma } from "../prisma";
import { buildOrderDocumentKey, safeFileName } from "../r2";
import {
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
  LOGISTICS_OPERATOR_ROLE,
  deleteManagedStoredFile,
  nextStandardFilenameForUpload,
  nonEmpty,
  normalizedCostType,
  readManagedUploadFile,
  runNonCriticalTask,
  uploadManagedFileToStorage,
  upsertFileAssetForOrderDocument,
  writeAudit,
} from "./shared";
import {
  asRecord,
  type LogisticsExpenseLike,
  type LogisticsInvoiceActor,
  type UnknownRecord,
} from "./logistics-expense-invoice-shared";

type AuditRequestLike = Parameters<typeof writeAudit>[0];

export async function createLogisticsInvoiceDocument(
  request: AuditRequestLike,
  actor: LogisticsInvoiceActor,
  expense: LogisticsExpenseLike,
  file: unknown,
  metadata: UnknownRecord = {}
) {
  const uploadedFile = await readManagedUploadFile(file, "invoicePdf", "invoice.pdf");
  const { originalFileName, mimeType, fileSize } = uploadedFile;
  const order = asRecord(expense.order);
  const cost = asRecord(expense.cost);
  const logisticsCostType = normalizedCostType(expense.cost?.costType || expense.costType);
  const extension = ".pdf";
  const costContext = { ...(expense.cost ? cost : { id: expense.costId }), costType: logisticsCostType };
  const orderId = nonEmpty(order.id);
  const baseStandardFilename = await nextStandardFilenameForUpload(order, "SUPPLIER_INVOICE", {
    cost: costContext,
    costId: nonEmpty(expense.costId),
    costType: logisticsCostType,
    supplierId: nonEmpty(expense.supplierId),
    relatedModule: "SUPPLIER",
  });
  const standardFilename = baseStandardFilename.replace(/\.pdf$/i, extension);
  const storageFileName = safeFileName(`${nonEmpty(order.orderNo) || orderId}_LOGISTICS_INVOICE_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${extension}`);
  const storageKey = buildOrderDocumentKey({
    orderId,
    documentType: "SUPPLIER_INVOICE",
    fileName: storageFileName,
    relatedModule: "SUPPLIER",
    supplierId: nonEmpty(expense.supplierId),
  });
  const storedFile = await uploadManagedFileToStorage({ file: uploadedFile, storageKey, fileName: standardFilename });
  try {
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.orderDocument.create({
        data: {
          orderId,
          costId: expense.costId || null,
          supplierId: expense.supplierId,
          relatedModule: "SUPPLIER",
          documentType: "SUPPLIER_INVOICE",
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
          uploadedById: actor?.id || null,
          uploadedAt: storedFile.uploadedAt,
        },
        include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
      });
      await upsertFileAssetForOrderDocument(tx, created, { logisticsExpenseId: expense.id || null });
      return created;
    });
    await runNonCriticalTask("物流发票上传日志写入", () => writeAudit(request, actor, "上传物流发票", "order_documents", document.id, null, {
      logisticsExpenseId: expense.id,
      invoiceGroup: metadata.invoiceGroup || "",
      fileName: standardFilename,
    }));
    return document;
  } catch (error: unknown) {
    await deleteManagedStoredFile(storedFile.storageKey).catch(() => null);
    throw error;
  }
}

export function canUploadLogisticsExpenseInvoice(actor: LogisticsInvoiceActor, expense: LogisticsExpenseLike) {
  const role = nonEmpty(actor?.role);
  if (["管理员", "财务"].includes(role)) return true;
  if (![LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(role)) return false;
  if (!actor) return false;
  if (!actor.supplierId || actor.supplierId !== expense.supplierId) return false;
  return Boolean(expense.supplier?.allowLogisticsInvoiceUpload);
}

export {
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
};
