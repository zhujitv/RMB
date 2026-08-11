import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { includeLogisticsExpenseRelations } from "./logistics-expense-access-relations";
import { logisticsBillSummaryRows } from "./logistics-expense-invoice-shared";
import {
  getLogisticsInvoiceNotificationSettings,
  renderLogisticsInvoiceNotificationEmail,
} from "./notification-templates";
import { NOTIFICATION_TEMPLATE_TYPES } from "./notification-definitions";
import {
  enabledAdminEmails,
  ensureNotificationTemplate,
  jsonOrNull,
  persistedNotificationBody,
  persistedNotificationContext,
  publicSendError,
  sendResendEmail,
  uniqueEmails,
} from "./notification-helpers";
import {
  codedError,
  logServerError,
  nonEmpty,
} from "./shared-base-utils";
import {
  LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX,
  LOGISTICS_INVOICE_OUTBOX_LEASE_MS,
  LOGISTICS_INVOICE_OUTBOX_MAX_ATTEMPTS,
  asRecord,
  resolveApprovalInvoiceRecipients,
  stringList,
  type ApprovalOutboxContext,
  type LoadedLogisticsExpense,
  type ProcessOutboxOptions,
} from "./logistics-invoice-outbox-model";
import {
  markOutboxSkipped,
  persistLogisticsInvoiceDeliveryFailure,
  persistLogisticsInvoiceDeliverySuccess,
} from "./logistics-invoice-outbox-delivery";

async function processLogisticsInvoiceNotificationOutboxRow(outboxId: string) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOGISTICS_INVOICE_OUTBOX_LEASE_MS);
  const claimed = await prisma.notificationOutbox.updateMany({
    where: {
      id: outboxId,
      type: NOTIFICATION_TEMPLATE_TYPES.LOGISTICS_INVOICE_NOTICE,
      relatedEntityType: "logistics_bills",
      idempotencyKey: { startsWith: LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX },
      scheduledAt: { lte: now },
      OR: [
        {
          status: { in: ["pending", "failed"] },
          attempts: { lt: LOGISTICS_INVOICE_OUTBOX_MAX_ATTEMPTS },
        },
        { status: "sending", updatedAt: { lte: staleBefore } },
      ],
    },
    data: { status: "sending", attempts: { increment: 1 }, lastError: null, updatedAt: now },
  });
  if (claimed.count !== 1) {
    const current = await prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
    const context = asRecord(current?.context);
    return {
      outboxId,
      sent: current?.status === "sent",
      skipped: current?.status === "skipped",
      queued: current?.status === "pending" || current?.status === "failed" || current?.status === "sending",
      claimed: false,
      error: current?.lastError || "",
      expenseIds: stringList(context.expenseIds),
      supplierName: nonEmpty(context.supplierName),
    };
  }
  let outbox = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outboxId } });
  let rows: LoadedLogisticsExpense[] = [];
  let providerDelivered = false;
  try {
    const context = asRecord(outbox.context) as ApprovalOutboxContext;
    const billId = nonEmpty(context.billId || outbox.relatedEntityId);
    if (!billId) throw codedError("通知任务缺少物流账单。", 409, "LOGISTICS_INVOICE_OUTBOX_BILL_REQUIRED");
    rows = await prisma.logisticsExpense.findMany({
      where: { billId, deletedAt: null },
      include: includeLogisticsExpenseRelations(),
      orderBy: [{ createdAt: "asc" }],
    });
    if (!rows.length) throw codedError("通知任务对应物流账单没有有效明细。", 409, "LOGISTICS_INVOICE_OUTBOX_ROWS_EMPTY");
    const currentBill = rows[0]?.bill;
    const currentReviewedAt = currentBill?.reviewedAt?.toISOString() || "";
    if (rows.some((row) => row.bill?.status === "voided" || row.bill?.auditStatus !== "审核通过")) {
      const skipped = await markOutboxSkipped(outbox, "账单已作废或不再是审核通过状态，通知已跳过。");
      return { ...skipped, claimed: true, expenseIds: rows.map((row) => row.id), supplierName: rows[0]?.supplierNameSnapshot || "" };
    }
    if (!currentReviewedAt || currentReviewedAt !== nonEmpty(context.approvedAt)) {
      const skipped = await markOutboxSkipped(outbox, "账单审批轮次已变化，旧开票通知已跳过。");
      return { ...skipped, claimed: true, expenseIds: rows.map((row) => row.id), supplierName: rows[0]?.supplierNameSnapshot || "" };
    }
    if (nonEmpty(currentBill?.invoiceStatus) !== "待开票") {
      const skipped = await markOutboxSkipped(outbox, "账单已上传或确认发票，无需再次发送上传提醒。");
      return { ...skipped, claimed: true, expenseIds: rows.map((row) => row.id), supplierName: rows[0]?.supplierNameSnapshot || "" };
    }
    if (rows[0]?.supplier?.allowLogisticsInvoiceUpload !== true) {
      const skipped = await markOutboxSkipped(outbox, "供应商未开通物流发票上传权限，不发送开票通知邮件。");
      return { ...skipped, claimed: true, expenseIds: rows.map((row) => row.id), supplierName: rows[0]?.supplierNameSnapshot || "" };
    }
    const settings = await getLogisticsInvoiceNotificationSettings();
    if (settings.autoSendOnApproval === false) {
      const skipped = await markOutboxSkipped(outbox, "自动发送开票通知已停用。");
      return { ...skipped, claimed: true, expenseIds: rows.map((row) => row.id), supplierName: rows[0]?.supplierNameSnapshot || "" };
    }
    const first = rows[0];
    const resolved = resolveApprovalInvoiceRecipients(asRecord(first.supplier), settings.recipientEmailFields);
    if (!resolved.emails.length) {
      throw codedError(`${resolved.error}未发送开票通知。`, 400, "LOGISTICS_SUPPLIER_EMAIL_REQUIRED");
    }
    const bills = logisticsBillSummaryRows(rows);
    const { subject, body } = await renderLogisticsInvoiceNotificationEmail(
      first.supplierNameSnapshot || first.supplier?.supplierName || "供应商",
      bills,
    );
    const template = await ensureNotificationTemplate(NOTIFICATION_TEMPLATE_TYPES.LOGISTICS_INVOICE_NOTICE);
    const adminCc = !template.securitySensitive && template.ccAdminEmails ? await enabledAdminEmails() : [];
    const recipientSet = new Set(resolved.emails);
    const ccEmails = uniqueEmails([template.securitySensitive ? [] : template.ccEmails || [], adminCc])
      .filter((email) => !recipientSet.has(email));
    const storedBody = persistedNotificationBody(template, body);
    const storedContext = persistedNotificationContext(template, {
      ...asRecord(outbox.context),
      phase: "sending",
      supplierId: first.supplierId || "",
      supplierName: first.supplierNameSnapshot || first.supplier?.supplierName || "",
      expenseIds: rows.map((row) => row.id),
      bills: bills.map((bill) => ({ orderNo: bill.orderNo, blNo: bill.blNo })),
    });
    const prepared = await prisma.notificationOutbox.updateMany({
      where: { id: outbox.id, status: "sending", attempts: outbox.attempts },
      data: {
        templateId: template.id,
        recipientEmails: resolved.emails,
        ccEmails,
        subject,
        body: storedBody,
        attachments: Prisma.JsonNull,
        context: jsonOrNull(storedContext),
      },
    });
    if (prepared.count !== 1) {
      throw codedError("通知任务状态已变化。", 409, "LOGISTICS_INVOICE_OUTBOX_STATE_CHANGED");
    }
    outbox = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outbox.id } });
    await sendResendEmail({
      recipientEmails: resolved.emails,
      ccEmails,
      subject,
      body,
      idempotencyKey: outbox.idempotencyKey || outbox.id,
    });
    providerDelivered = true;
    await persistLogisticsInvoiceDeliverySuccess(outbox, rows, resolved.emails, ccEmails, subject, storedBody);
    return {
      outboxId: outbox.id,
      sent: true,
      skipped: false,
      queued: false,
      claimed: true,
      error: "",
      expenseIds: rows.map((row) => row.id),
      supplierName: first.supplierNameSnapshot || first.supplier?.supplierName || "供应商",
    };
  } catch (error: unknown) {
    const message = publicSendError(error);
    if (providerDelivered) {
      logServerError("物流开票邮件已送达但状态落库失败", error, { outboxId: outbox.id });
      return {
        outboxId: outbox.id,
        sent: true,
        skipped: false,
        queued: true,
        claimed: true,
        error: "",
        trackingError: message,
        expenseIds: rows.map((row) => row.id),
        supplierName: rows[0]?.supplierNameSnapshot || rows[0]?.supplier?.supplierName || "供应商",
      };
    }
    try {
      await persistLogisticsInvoiceDeliveryFailure(outbox, rows, message);
    } catch (trackingError: unknown) {
      logServerError("物流开票邮件失败状态落库失败", trackingError, { outboxId: outbox.id, message });
    }
    return {
      outboxId: outbox.id,
      sent: false,
      skipped: false,
      queued: outbox.attempts < LOGISTICS_INVOICE_OUTBOX_MAX_ATTEMPTS,
      claimed: true,
      error: message,
      expenseIds: rows.map((row) => row.id),
      supplierName: rows[0]?.supplierNameSnapshot || rows[0]?.supplier?.supplierName || "供应商",
    };
  }
}

export async function processLogisticsInvoiceNotificationOutbox(options: ProcessOutboxOptions = {}) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOGISTICS_INVOICE_OUTBOX_LEASE_MS);
  const keys = [...new Set((options.idempotencyKeys || []).map(nonEmpty).filter(Boolean))];
  if (options.idempotencyKeys && !keys.length) {
    return { scanned: 0, sent: 0, failed: 0, skipped: 0, queued: 0, results: [] };
  }
  const requestedLimit = Number(options.limit || 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, Math.trunc(requestedLimit)))
    : 10;
  const candidates = await prisma.notificationOutbox.findMany({
    where: {
      type: NOTIFICATION_TEMPLATE_TYPES.LOGISTICS_INVOICE_NOTICE,
      relatedEntityType: "logistics_bills",
      idempotencyKey: {
        startsWith: LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX,
        ...(keys.length ? { in: keys } : {}),
      },
      scheduledAt: { lte: now },
      OR: [
        {
          status: { in: ["pending", "failed"] },
          attempts: { lt: LOGISTICS_INVOICE_OUTBOX_MAX_ATTEMPTS },
        },
        { status: "sending", updatedAt: { lte: staleBefore } },
      ],
    },
    select: { id: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
  const results: Awaited<ReturnType<typeof processLogisticsInvoiceNotificationOutboxRow>>[] = [];
  for (const candidate of candidates) {
    results.push(await processLogisticsInvoiceNotificationOutboxRow(candidate.id));
  }
  return {
    scanned: candidates.length,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => result.claimed && !result.sent && !result.skipped).length,
    skipped: results.filter((result) => result.skipped).length,
    queued: results.filter((result) => result.queued).length,
    results,
  };
}
