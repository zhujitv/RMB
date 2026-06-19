// @ts-nocheck
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, safeFileName, uploadToR2 } from "../r2";
import {
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
  LOGISTICS_OPERATOR_ROLE,
  codedError,
  customerBusinessName,
  nextStandardFilenameForUpload,
  normalizeEmail,
  normalizedCostType,
  readValidatedPdfUploadFile,
  runNonCriticalTask,
  validEmail,
  writeAudit,
} from "./shared";
import { sendShippingDocumentsEmail } from "./shipping-documents";

function logisticsExpenseInvoiceEmail(expense = {}) {
  const order = expense.order || {};
  const subject = `物流费用已审核通过，请开票并上传发票 - ${order.orderNo || "-"}/${order.blNo || "-"}`;
  const body = [
    `${expense.supplierNameSnapshot || expense.supplier?.supplierName || "供应商"}，您好：`,
    "",
    "以下物流费用已审核通过，请按开票要求开具发票并登录系统上传发票。",
    "",
    `订单号：${order.orderNo || "-"}`,
    `提单号：${order.blNo || "-"}`,
    `客户简称：${customerBusinessName(order.customer, order.customerNameSnapshot) || "-"}`,
    "",
    "费用明细：",
    `- ${normalizedCostType(expense.costType)} ${expense.currency || "CNY"} ${Number(expense.amount || 0).toFixed(2)}，折人民币 ${Number(expense.amountCny || 0).toFixed(2)}`,
    "",
    `合计金额：CNY ${Number(expense.amountCny || 0).toFixed(2)}`,
    "开票要求：请确保发票金额、抬头、税号与系统供应商资料一致。",
    `发票上传入口链接：${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || "https://www.nextwood.net"}`,
    "",
    "NEXTWOOD 供应链协同平台",
  ].join("\n");
  return { subject, body };
}

export async function notifyLogisticsSupplierInvoice(expense) {
  const email = normalizeEmail(expense.supplier?.email || "");
  if (!email || !validEmail(email)) throw codedError("物流供应商未配置有效邮箱，未发送开票通知。", 400, "LOGISTICS_SUPPLIER_EMAIL_REQUIRED");
  const { subject, body } = logisticsExpenseInvoiceEmail(expense);
  await sendShippingDocumentsEmail({
    recipientEmails: [email],
    ccEmails: [],
    attachments: [],
    subject,
    body,
    notificationId: `logistics-expense-${expense.id}`,
  });
}

export async function createLogisticsInvoiceDocument(request, actor, expense, file, metadata = {}) {
  const { originalFileName, mimeType, body, fileSize } = await readValidatedPdfUploadFile(file, "invoice.pdf");
  const order = expense.order;
  const costContext = expense.cost || { id: expense.costId, costType: expense.costType };
  const baseStandardFilename = await nextStandardFilenameForUpload(order, "SUPPLIER_INVOICE", {
    cost: costContext,
    costId: expense.costId,
    supplierId: expense.supplierId,
    relatedModule: "SUPPLIER",
  });
  const standardFilename = baseStandardFilename.replace(/\.pdf$/i, ".pdf");
  const { bucket: r2Bucket } = ensureR2Configured();
  const storageFileName = safeFileName(`${order.orderNo || order.id}_LOGISTICS_INVOICE_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.pdf`);
  const storageKey = buildOrderDocumentKey({
    orderId: order.id,
    documentType: "SUPPLIER_INVOICE",
    fileName: storageFileName,
    relatedModule: "SUPPLIER",
    supplierId: expense.supplierId,
  });
  await uploadToR2({ key: storageKey, body, contentType: mimeType });
  try {
    const document = await prisma.orderDocument.create({
      data: {
        orderId: order.id,
        costId: expense.costId || null,
        supplierId: expense.supplierId,
        relatedModule: "SUPPLIER",
        documentType: "SUPPLIER_INVOICE",
        fileName: standardFilename,
        originalName: originalFileName,
        originalFilename: originalFileName,
        standardFilename,
        fileSize,
        mimeType,
        r2Bucket,
        storageKey,
        fileUrl: null,
        uploadStatus: "SUCCESS",
        uploadProgress: 100,
        uploadedById: actor.id,
        uploadedAt: new Date(),
      },
      include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    });
    await runNonCriticalTask("物流发票上传日志写入", () => writeAudit(request, actor, "上传物流发票", "order_documents", document.id, null, {
      logisticsExpenseId: expense.id,
      invoiceNo: metadata.invoiceNo || "",
      fileName: standardFilename,
    }));
    return document;
  } catch (error) {
    await deleteR2Object(storageKey).catch(() => null);
    throw error;
  }
}

export function canUploadLogisticsExpenseInvoice(actor, expense) {
  if (["管理员", "财务"].includes(actor?.role)) return true;
  if (![LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(actor?.role)) return false;
  if (!actor.supplierId || actor.supplierId !== expense.supplierId) return false;
  return Boolean(expense.supplier?.allowLogisticsInvoiceUpload);
}

export {
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
};
