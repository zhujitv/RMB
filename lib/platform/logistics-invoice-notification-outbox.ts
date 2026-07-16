import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import { includeLogisticsExpenseRelations } from "./logistics-expense-access-relations";
import { logisticsBillSummaryRows, type LogisticsExpenseLike } from "./logistics-expense-invoice-shared";
import {
  getLogisticsInvoiceNotificationSettings,
  renderLogisticsInvoiceNotificationEmail,
} from "./notification-templates";
import { NOTIFICATION_TEMPLATE_TYPES } from "./notification-definitions";
import {
  bodyPreview,
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
  DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
} from "./shared-constants";
import {
  codedError,
  logServerError,
  nonEmpty,
  normalizeEmail,
  validEmail,
} from "./shared-base-utils";

const LOGISTICS_INVOICE_OUTBOX_MAX_ATTEMPTS = 5;
const LOGISTICS_INVOICE_OUTBOX_LEASE_MS = 10 * 60 * 1000;
const LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX = "logistics-invoice-approval:";

type ApprovalIntentRow = LogisticsExpenseLike & {
  billId?: string | null;
  bill?: { id?: string | null } | null;
};

type LoadedLogisticsExpense = Prisma.LogisticsExpenseGetPayload<{
  include: ReturnType<typeof includeLogisticsExpenseRelations>;
}>;

type ApprovalOutboxContext = {
  billId: string;
  orderId: string;
  approvedAt: string;
  approvedById: string;
  phase: string;
  expenseIds?: string[];
};

type ProcessOutboxOptions = {
  idempotencyKeys?: string[];
  limit?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(nonEmpty).filter(Boolean) : [];
}

function resolveApprovalInvoiceRecipients(
  supplier: Record<string, unknown> = {},
  recipientEmailFields = DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS,
) {
  const selected = new Set((Array.isArray(recipientEmailFields) && recipientEmailFields.length
    ? recipientEmailFields
    : DEFAULT_LOGISTICS_INVOICE_SUPPLIER_EMAIL_FIELDS
  ).map((item) => nonEmpty(item)));
  const candidates = [
    { key: "email", field: "supplier.email", value: supplier.email },
    ...(Array.isArray(supplier.operatorUsers) ? supplier.operatorUsers : [])
      .filter((user) => asRecord(user).isActive !== false)
      .map((user) => ({ key: "operatorUsers.email", field: "supplier.operatorUsers.email", value: asRecord(user).email })),
  ].filter((candidate) => selected.has(candidate.key));
  const emails = candidates
    .map((candidate) => normalizeEmail(candidate.value || ""))
    .filter((email) => email && validEmail(email))
    .filter((email, index, values) => values.indexOf(email) === index);
  const checkedText = candidates.map((candidate) => candidate.field).join("、") || "supplier.email";
  return {
    emails,
    error: emails.length ? "" : `物流供应商未配置有效邮箱（已检查：${checkedText}），`,
  };
}

function rowBillId(row: ApprovalIntentRow) {
  return nonEmpty(row.billId || row.bill?.id);
}

export function logisticsInvoiceApprovalOutboxKey(billId: unknown, approvedAt: Date | string) {
  const approvedAtIso = approvedAt instanceof Date ? approvedAt.toISOString() : new Date(approvedAt).toISOString();
  return `${LOGISTICS_INVOICE_APPROVAL_OUTBOX_PREFIX}${nonEmpty(billId)}:${approvedAtIso}`;
}

export async function createLogisticsInvoiceApprovalOutboxIntents(
  tx: Prisma.TransactionClient,
  rows: ApprovalIntentRow[] = [],
  approvedById: string,
  approvedAt: Date,
) {
  const rowsByBillId = new Map<string, ApprovalIntentRow[]>();
  for (const row of rows) {
    const billId = rowBillId(row);
    if (!billId) continue;
    if (!rowsByBillId.has(billId)) rowsByBillId.set(billId, []);
    rowsByBillId.get(billId)!.push(row);
  }
  const intents = [...rowsByBillId.entries()].map(([billId, billRows]) => {
    const first = billRows[0] || {};
    const orderId = nonEmpty(first.orderId);
    return {
      type: NOTIFICATION_TEMPLATE_TYPES.LOGISTICS_INVOICE_NOTICE,
      idempotencyKey: logisticsInvoiceApprovalOutboxKey(billId, approvedAt),
      status: "pending",
      recipientEmails: [],
      ccEmails: [],
      subject: "物流费用审核通过，等待生成开票通知",
      body: "",
      context: {
        billId,
        orderId,
        approvedAt: approvedAt.toISOString(),
        approvedById,
        phase: "prepare",
        expenseIds: billRows.map((row) => nonEmpty(row.id)).filter(Boolean),
      } satisfies ApprovalOutboxContext,
      relatedEntityType: "logistics_bills",
      relatedEntityId: billId,
      relatedOrderId: orderId || null,
      scheduledAt: approvedAt,
    };
  });
  if (!intents.length) return [];
  await tx.notificationOutbox.createMany({ data: intents, skipDuplicates: true });
  const keys = intents.map((intent) => intent.idempotencyKey);
  const persisted = await tx.notificationOutbox.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { id: true, idempotencyKey: true },
    take: keys.length,
  });
  if (persisted.length !== keys.length) {
    throw codedError("物流开票通知任务未完整入队，审核已取消。", 409, "LOGISTICS_INVOICE_OUTBOX_INCOMPLETE");
  }
  return persisted.map((item) => ({ id: item.id, idempotencyKey: item.idempotencyKey || "" }));
}

async function markOutboxSkipped(outbox: Awaited<ReturnType<typeof prisma.notificationOutbox.findUniqueOrThrow>>, reason: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationOutbox.updateMany({
      where: { id: outbox.id, status: "sending", attempts: outbox.attempts },
      data: { status: "skipped", lastError: reason || null, failedAt: null },
    });
    if (updated.count !== 1) {
      throw codedError("通知任务状态已变化。", 409, "LOGISTICS_INVOICE_OUTBOX_STATE_CHANGED");
    }
    await tx.notificationDeliveryLog.create({
      data: {
        outboxId: outbox.id,
        templateId: outbox.templateId,
        type: outbox.type,
        status: "skipped",
        recipientEmails: uniqueEmails([outbox.recipientEmails]),
        ccEmails: jsonOrNull(outbox.ccEmails),
        subject: outbox.subject,
        bodyPreview: bodyPreview(outbox.body),
        relatedEntityType: outbox.relatedEntityType,
        relatedEntityId: outbox.relatedEntityId,
        relatedOrderId: outbox.relatedOrderId,
        errorMessage: reason || null,
        provider: "system",
        sentAt: now,
      },
    });
  });
  return { outboxId: outbox.id, sent: false, skipped: true, queued: false, error: reason };
}

async function persistLogisticsInvoiceDeliverySuccess(
  outbox: Awaited<ReturnType<typeof prisma.notificationOutbox.findUniqueOrThrow>>,
  rows: Array<{ id: string; billId: string | null }>,
  recipientEmails: string[],
  ccEmails: string[],
  subject: string,
  storedBody: string,
) {
  const sentAt = new Date();
  const expenseIds = rows.map((row) => row.id);
  const billIds = [...new Set(rows.map((row) => nonEmpty(row.billId)).filter(Boolean))];
  await prisma.$transaction(async (tx) => {
    const outboxUpdate = await tx.notificationOutbox.updateMany({
      where: { id: outbox.id, status: "sending", attempts: outbox.attempts },
      data: {
        status: "sent",
        sentAt,
        failedAt: null,
        lastError: null,
        recipientEmails,
        ccEmails,
        subject,
        body: storedBody,
        context: jsonOrNull({ ...asRecord(outbox.context), phase: "sent", expenseIds }),
      },
    });
    if (outboxUpdate.count !== 1) {
      throw codedError("通知任务状态已变化。", 409, "LOGISTICS_INVOICE_OUTBOX_STATE_CHANGED");
    }
    await tx.notificationDeliveryLog.create({
      data: {
        outboxId: outbox.id,
        templateId: outbox.templateId,
        type: outbox.type,
        status: "sent",
        recipientEmails,
        ccEmails,
        subject,
        bodyPreview: bodyPreview(storedBody),
        relatedEntityType: outbox.relatedEntityType,
        relatedEntityId: outbox.relatedEntityId,
        relatedOrderId: outbox.relatedOrderId,
        provider: "resend",
        sentAt,
      },
    });
    if (expenseIds.length) {
      await tx.logisticsExpense.updateMany({
        where: { id: { in: expenseIds }, deletedAt: null },
        data: { invoiceNotifiedAt: sentAt, invoiceNotificationError: null },
      });
    }
    if (billIds.length) {
      await tx.logisticsBill.updateMany({
        where: { id: { in: billIds }, deletedAt: null },
        data: { invoiceNotifiedAt: sentAt, invoiceNotificationError: null },
      });
    }
  });
}

async function persistLogisticsInvoiceDeliveryFailure(
  outbox: Awaited<ReturnType<typeof prisma.notificationOutbox.findUniqueOrThrow>>,
  rows: Array<{ id: string; billId: string | null }>,
  message: string,
) {
  const failedAt = new Date();
  const retryDelayMs = Math.min(30 * 60 * 1000, Math.max(60 * 1000, 2 ** Math.max(0, outbox.attempts - 1) * 60 * 1000));
  const scheduledAt = new Date(failedAt.getTime() + retryDelayMs);
  const expenseIds = rows.map((row) => row.id);
  const billIds = [...new Set(rows.map((row) => nonEmpty(row.billId)).filter(Boolean))];
  await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationOutbox.updateMany({
      where: { id: outbox.id, status: "sending", attempts: outbox.attempts },
      data: { status: "failed", failedAt, lastError: message, scheduledAt },
    });
    if (updated.count !== 1) {
      throw codedError("通知任务状态已变化。", 409, "LOGISTICS_INVOICE_OUTBOX_STATE_CHANGED");
    }
    await tx.notificationDeliveryLog.create({
      data: {
        outboxId: outbox.id,
        templateId: outbox.templateId,
        type: outbox.type,
        status: "failed",
        recipientEmails: uniqueEmails([outbox.recipientEmails]),
        ccEmails: jsonOrNull(outbox.ccEmails),
        subject: outbox.subject,
        bodyPreview: bodyPreview(outbox.body),
        relatedEntityType: outbox.relatedEntityType,
        relatedEntityId: outbox.relatedEntityId,
        relatedOrderId: outbox.relatedOrderId,
        errorMessage: message,
        provider: "resend",
      },
    });
    if (expenseIds.length) {
      await tx.logisticsExpense.updateMany({
        where: { id: { in: expenseIds }, deletedAt: null },
        data: { invoiceNotificationError: message },
      });
    }
    if (billIds.length) {
      await tx.logisticsBill.updateMany({
        where: { id: { in: billIds }, deletedAt: null },
        data: { invoiceNotificationError: message },
      });
    }
  });
}

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
