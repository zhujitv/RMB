import {
  DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
  codedError,
  nonEmpty,
  normalizeEmail,
  validEmail,
} from "./shared";
import { getLogisticsInvoiceNotificationSettings, renderLogisticsInvoiceNotificationEmail } from "./notification-templates";
import { NOTIFICATION_TEMPLATE_TYPES, sendNotificationEmail } from "./notification-engine";
import {
  errorMessage,
  logisticsBillSummaryRows,
  type LogisticsExpenseLike,
  type SupplierLike,
  type EmailCandidate,
  type InvoiceNotificationResult,
  type InvoiceRecipientResolution,
  type SupplierNotificationGroup,
} from "./logistics-expense-invoice-shared";

function supplierOperatorEmailCandidates(supplier: SupplierLike = {}): EmailCandidate[] {
  return (supplier.operatorUsers || [])
    .filter((user) => user && user.isActive !== false)
    .map((user) => ({
      key: "operatorUsers.email",
      label: "绑定登录账号邮箱",
      field: "supplier.operatorUsers.email",
      value: user.email || "",
    }));
}

function logisticsSupplierEmailCandidates(supplier: SupplierLike = {}): EmailCandidate[] {
  return [
    ...supplierOperatorEmailCandidates(supplier),
    { key: "contactEmail", label: "供应商联系邮箱", field: "supplier.contactEmail", value: supplier.contactEmail || "" },
    { key: "email", label: "供应商主邮箱", field: "supplier.email", value: supplier.email || "" },
    { key: "financeEmail", label: "供应商财务邮箱", field: "supplier.financeEmail", value: supplier.financeEmail || "" },
  ];
}

export function resolveLogisticsSupplierInvoiceRecipients(
  supplier: SupplierLike = {},
  recipientEmailFields = DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
): InvoiceRecipientResolution {
  const selected = new Set((Array.isArray(recipientEmailFields) && recipientEmailFields.length
    ? recipientEmailFields
    : DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS
  ).map((item) => String(item || "").trim()));
  const candidates = logisticsSupplierEmailCandidates(supplier).filter((candidate) => selected.has(candidate.key));
  const fallbackCandidates = candidates.length ? candidates : logisticsSupplierEmailCandidates(supplier);
  const checkedFields = candidates.map((candidate) => candidate.field);
  const checkedText = checkedFields.join("、");
  const emails: string[] = [];
  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.value || "");
    if (email && validEmail(email)) emails.push(email);
  }
  const uniqueEmails = emails.filter((email, index, arr) => arr.indexOf(email) === index);
  if (uniqueEmails.length) {
    const matchedCandidate = candidates.find((candidate) => normalizeEmail(candidate.value || "") === uniqueEmails[0]);
    return {
      email: uniqueEmails[0],
      emails: uniqueEmails,
      label: matchedCandidate?.label || "",
      field: matchedCandidate?.field || "",
      checkedFields,
      checkedText,
      error: "",
    };
  }
  const checkedFallbackText = (checkedFields.length ? checkedFields : fallbackCandidates.map((candidate) => candidate.field)).join("、");
  return {
    email: "",
    emails: [],
    label: "",
    field: "",
    checkedFields: checkedFields.length ? checkedFields : fallbackCandidates.map((candidate) => candidate.field),
    checkedText: checkedFallbackText,
    error: `物流供应商未配置有效邮箱（已检查：${checkedFallbackText}），`,
  };
}

export async function notifyLogisticsSupplierInvoice(expense: LogisticsExpenseLike) {
  const settings = await getLogisticsInvoiceNotificationSettings();
  if (settings.autoSendOnApproval === false) return;
  const resolved = resolveLogisticsSupplierInvoiceRecipients(expense.supplier || {}, settings.recipientEmailFields);
  if (!resolved.emails.length) throw codedError(`${resolved.error}未发送开票通知。`, 400, "LOGISTICS_SUPPLIER_EMAIL_REQUIRED");
  const bills = logisticsBillSummaryRows([expense]);
  const { subject, body } = await renderLogisticsInvoiceNotificationEmail(
    expense.supplierNameSnapshot || expense.supplier?.supplierName || "供应商",
    bills,
  );
  const delivery = await sendNotificationEmail({
    type: NOTIFICATION_TEMPLATE_TYPES.LOGISTICS_INVOICE_NOTICE,
    recipientEmails: resolved.emails,
    subjectOverride: subject,
    bodyOverride: body,
    idempotencyKey: `logistics-expense-${expense.id}`,
    relatedEntityType: "logistics_expenses",
    relatedEntityId: expense.id || "",
    relatedOrderId: expense.orderId || "",
    context: { supplierId: expense.supplierId || "", bills },
  });
  if (delivery.skipped || delivery.sent !== true) {
    throw codedError(delivery.error || "物流费用开票通知模板已停用，未发送。", 409, "NOTIFICATION_TEMPLATE_DISABLED");
  }
}

export async function notifyLogisticsSupplierInvoiceBills(expenses: LogisticsExpenseLike[] = []): Promise<InvoiceNotificationResult[]> {
  const settings = await getLogisticsInvoiceNotificationSettings();
  const bills = logisticsBillSummaryRows(expenses);
  const bySupplier = new Map<string, SupplierNotificationGroup>();
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
    const group = bySupplier.get(key)!;
    group.bills.push(bill);
    group.expenses.push(...bill.expenses);
  }
  const results: InvoiceNotificationResult[] = [];
  for (const group of bySupplier.values()) {
    if (settings.autoSendOnApproval === false) {
      results.push({
        supplierId: group.supplierId || "",
        supplierName: group.supplierName || "供应商",
        sent: false,
        skipped: true,
        error: "",
        expenseIds: group.expenses.map((expense) => nonEmpty(expense.id)).filter(Boolean),
      });
      continue;
    }
    const resolved = resolveLogisticsSupplierInvoiceRecipients(group.supplier || { email: group.supplierEmail }, settings.recipientEmailFields);
    if (!resolved.emails.length) {
      results.push({
        supplierId: group.supplierId || "",
        supplierName: group.supplierName || "供应商",
        sent: false,
        error: `${resolved.error}未发送开票通知。`,
        expenseIds: group.expenses.map((expense) => nonEmpty(expense.id)).filter(Boolean),
      });
      continue;
    }
    try {
      const { subject, body } = await renderLogisticsInvoiceNotificationEmail(group.supplierName || "供应商", group.bills);
      const delivery = await sendNotificationEmail({
        type: NOTIFICATION_TEMPLATE_TYPES.LOGISTICS_INVOICE_NOTICE,
        recipientEmails: resolved.emails,
        subjectOverride: subject,
        bodyOverride: body,
        idempotencyKey: `logistics-expense-invoice-${group.supplierId || resolved.email}-${group.bills.map((bill) => `${bill.orderNo}-${bill.blNo}`).join("-")}`.slice(0, 180),
        relatedEntityType: "logistics_expense_invoice_notice",
        relatedEntityId: group.supplierId || resolved.email,
        relatedOrderId: group.expenses[0]?.orderId || "",
        context: {
          supplierId: group.supplierId || "",
          supplierName: group.supplierName || "",
          expenseIds: group.expenses.map((expense) => nonEmpty(expense.id)).filter(Boolean),
          bills: group.bills.map((bill) => ({ orderNo: bill.orderNo, blNo: bill.blNo })),
        },
      });
      if (delivery.skipped || delivery.sent !== true) throw codedError(delivery.error || "物流费用开票通知模板已停用，未发送。", 409, "NOTIFICATION_TEMPLATE_DISABLED");
      results.push({
        supplierId: group.supplierId || "",
        supplierName: group.supplierName || "供应商",
        sent: true,
        error: "",
        expenseIds: group.expenses.map((expense) => nonEmpty(expense.id)).filter(Boolean),
      });
    } catch (error: unknown) {
      results.push({
        supplierId: group.supplierId || "",
        supplierName: group.supplierName || "供应商",
        sent: false,
        error: errorMessage(error, "邮件发送失败"),
        expenseIds: group.expenses.map((expense) => nonEmpty(expense.id)).filter(Boolean),
      });
    }
  }
  return results;
}
