// @ts-nocheck
import { prisma } from "../prisma";
import { buildOrderDocumentKey, deleteR2Object, ensureR2Configured, safeFileName, uploadToR2 } from "../r2";
import {
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_EXPENSE_PAYMENT_STATUSES,
  LOGISTICS_OPERATOR_ROLE,
  codedError,
  customerBusinessName,
  customerShortName,
  nextStandardFilenameForUpload,
  normalizeEmail,
  normalizedCostType,
  readValidatedPdfUploadFile,
  runNonCriticalTask,
  validEmail,
  writeAudit,
} from "./shared";
import { logisticsExpenseOrderSummary } from "./logistics-expense-access";
import { logisticsInvoiceGroupsForCostTypes } from "./logistics-invoice-groups";
import { getLogisticsInvoiceNotificationSettings, renderLogisticsInvoiceNotificationEmail } from "./notification-templates";
import { sendShippingDocumentsEmail } from "./shipping-documents";

function logisticsExpenseCustomerShortName(expense = {}) {
  const order = expense.order || {};
  return customerShortName(order.customer) || customerBusinessName(order.customer, order.customerNameSnapshot) || "-";
}

function logisticsExpenseContainerSummaryText(expense = {}) {
  const orderSummary = logisticsExpenseOrderSummary(expense.order || {});
  const items = orderSummary.transportItems || [];
  const counts = new Map();
  for (const item of items) {
    const type = String(item.containerType || "").trim().toUpperCase();
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  const typeText = [...counts.entries()].map(([type, count]) => `${type}×${count}`).join("，");
  if (typeText) return typeText;
  if (orderSummary.containerCount) return `${orderSummary.containerCount} 个柜`;
  return "未录入";
}

function logisticsExpenseDetailText(expenses = []) {
  return expenses.map((expense, index) => {
    const amount = Number(expense.amount || 0).toFixed(2);
    const amountCnyText = Number(expense.amountCny || 0).toFixed(2);
    const quantity = expense.billingQuantity == null
      ? Number(expense.appliedContainerCount || 1)
      : Number(expense.billingQuantity || 1);
    const remark = expense.remark ? `，备注：${expense.remark}` : "";
    return `${index + 1}. ${normalizedCostType(expense.costType)}，数量 ${quantity || 1}，${expense.currency || "CNY"} ${amount}，折人民币 ¥${amountCnyText}${remark}`;
  }).join("\n");
}

function logisticsBillSummaryRows(expenses = []) {
  const groups = new Map();
  for (const expense of expenses) {
    const order = expense.order || {};
    const orderSummary = logisticsExpenseOrderSummary(order);
    const key = [expense.supplierId || "", expense.orderId || "", orderSummary.blNo || orderSummary.billOfLadingNo || orderSummary.orderNo || ""].join("::");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(expense);
  }
  return [...groups.values()].map((rows) => {
    const first = rows[0] || {};
    const order = first.order || {};
    const orderSummary = logisticsExpenseOrderSummary(order);
    return {
      supplierId: first.supplierId || "",
      supplierName: first.supplierNameSnapshot || first.supplier?.supplierName || "供应商",
      supplier: first.supplier || null,
      supplierEmail: first.supplier?.email || "",
      orderNo: order.orderNo || "-",
      blNo: orderSummary.blNo || orderSummary.billOfLadingNo || "-",
      containerSummary: logisticsExpenseContainerSummaryText(first),
      customerShortName: logisticsExpenseCustomerShortName(first),
      amountCny: rows.reduce((sum, row) => sum + Number(row.amountCny || 0), 0),
      detailText: logisticsExpenseDetailText(rows),
      invoiceGroups: logisticsInvoiceGroupsForCostTypes(rows.map((row) => row.costType)),
      remark: rows.map((row) => row.remark || "").filter(Boolean).join("；") || "-",
      expenses: rows,
    };
  });
}

function supplierOperatorEmailCandidates(supplier = {}) {
  return (supplier.operatorUsers || [])
    .filter((user) => user && user.isActive !== false)
    .map((user) => ({
      label: "绑定登录账号邮箱",
      field: "supplier.operatorUsers.email",
      value: user.email || "",
    }));
}

export function resolveLogisticsSupplierInvoiceEmail(supplier = {}) {
  const candidates = [
    ...supplierOperatorEmailCandidates(supplier),
    { label: "供应商联系邮箱", field: "supplier.contactEmail", value: supplier.contactEmail || "" },
    { label: "供应商主邮箱", field: "supplier.email", value: supplier.email || "" },
    { label: "供应商财务邮箱", field: "supplier.financeEmail", value: supplier.financeEmail || "" },
  ];
  const checkedFields = candidates.map((candidate) => candidate.field);
  const checkedText = checkedFields.join("、");
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.value || "");
    if (email && validEmail(email)) {
      return {
        email,
        label: candidate.label,
        field: candidate.field,
        checkedFields,
        checkedText,
        error: "",
      };
    }
  }
  return {
    email: "",
    label: "",
    field: "",
    checkedFields,
    checkedText,
    error: `物流供应商未配置有效邮箱，已检查：${checkedText}。`,
  };
}

export async function notifyLogisticsSupplierInvoice(expense) {
  const settings = await getLogisticsInvoiceNotificationSettings();
  if (settings.autoSendOnApproval === false) return;
  const resolved = resolveLogisticsSupplierInvoiceEmail(expense.supplier || {});
  if (!resolved.email) throw codedError(`${resolved.error}未发送开票通知。`, 400, "LOGISTICS_SUPPLIER_EMAIL_REQUIRED");
  const bills = logisticsBillSummaryRows([expense]);
  const { subject, body } = await renderLogisticsInvoiceNotificationEmail(
    expense.supplierNameSnapshot || expense.supplier?.supplierName || "供应商",
    bills,
  );
  await sendShippingDocumentsEmail({
    recipientEmails: [resolved.email],
    ccEmails: [],
    attachments: [],
    subject,
    body,
    notificationId: `logistics-expense-${expense.id}`,
  });
}

export async function notifyLogisticsSupplierInvoiceBills(expenses = []) {
  const settings = await getLogisticsInvoiceNotificationSettings();
  const bills = logisticsBillSummaryRows(expenses);
  const bySupplier = new Map();
  for (const bill of bills) {
    const key = bill.supplierId || bill.supplierEmail || bill.supplierName;
    if (!bySupplier.has(key)) bySupplier.set(key, {
      supplierId: bill.supplierId,
      supplierName: bill.supplierName,
      supplierEmail: bill.supplierEmail,
      supplier: bill.supplier,
      bills: [],
      expenses: [],
    });
    const group = bySupplier.get(key);
    group.bills.push(bill);
    group.expenses.push(...bill.expenses);
  }
  const results = [];
  for (const group of bySupplier.values()) {
    if (settings.autoSendOnApproval === false) {
      results.push({
        supplierId: group.supplierId || "",
        supplierName: group.supplierName || "供应商",
        sent: false,
        skipped: true,
        error: "",
        expenseIds: group.expenses.map((expense) => expense.id).filter(Boolean),
      });
      continue;
    }
    const resolved = resolveLogisticsSupplierInvoiceEmail(group.supplier || { email: group.supplierEmail });
    if (!resolved.email) {
      results.push({
        supplierId: group.supplierId || "",
        supplierName: group.supplierName || "供应商",
        sent: false,
        error: `${resolved.error}未发送开票通知。`,
        expenseIds: group.expenses.map((expense) => expense.id).filter(Boolean),
      });
      continue;
    }
    const { subject, body } = await renderLogisticsInvoiceNotificationEmail(group.supplierName, group.bills);
    try {
      await sendShippingDocumentsEmail({
        recipientEmails: [resolved.email],
        ccEmails: [],
        attachments: [],
        subject,
        body,
        notificationId: `logistics-expense-invoice-${group.supplierId || resolved.email}-${group.bills.map((bill) => `${bill.orderNo}-${bill.blNo}`).join("-")}`.slice(0, 180),
      });
      results.push({
        supplierId: group.supplierId || "",
        supplierName: group.supplierName || "供应商",
        sent: true,
        error: "",
        expenseIds: group.expenses.map((expense) => expense.id).filter(Boolean),
      });
    } catch (error) {
      results.push({
        supplierId: group.supplierId || "",
        supplierName: group.supplierName || "供应商",
        sent: false,
        error: error?.message || "邮件发送失败",
        expenseIds: group.expenses.map((expense) => expense.id).filter(Boolean),
      });
    }
  }
  return results;
}

export async function createLogisticsInvoiceDocument(request, actor, expense, file, metadata = {}) {
  const { originalFileName, mimeType, body, fileSize } = await readValidatedPdfUploadFile(file, "invoice.pdf");
  const order = expense.order;
  const logisticsCostType = normalizedCostType(expense.cost?.costType || expense.costType);
  const costContext = { ...(expense.cost || { id: expense.costId }), costType: logisticsCostType };
  const baseStandardFilename = await nextStandardFilenameForUpload(order, "SUPPLIER_INVOICE", {
    cost: costContext,
    costId: expense.costId,
    costType: logisticsCostType,
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
      invoiceGroup: metadata.invoiceGroup || "",
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
