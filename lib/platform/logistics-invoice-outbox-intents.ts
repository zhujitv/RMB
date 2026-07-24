import { Prisma } from "../generated/prisma/client.js";
import { codedError, nonEmpty } from "./shared-base-utils";
import { NOTIFICATION_TEMPLATE_TYPES } from "./notification-definitions";
import {
  logisticsInvoiceApprovalOutboxKey,
  rowBillId,
  type ApprovalIntentRow,
  type ApprovalOutboxContext,
} from "./logistics-invoice-outbox-model";

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
