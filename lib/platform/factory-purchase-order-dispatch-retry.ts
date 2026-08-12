import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import {
  lockFactoryPurchaseOrders,
  lockSalesExecution,
  requireSalesExecutionActorId,
  assertExpectedSalesExecutionRevision,
  type SalesExecutionActor,
} from "./sales-execution-access";
import { loadSalesExecution } from "./sales-execution-query-service";
import { serializeSalesExecution } from "./sales-execution-values";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import {
  factoryDispatchIdempotencyKey,
  queueFactoryPurchaseOrderDispatchOutbox,
} from "./factory-purchase-order-dispatch-outbox";
import { processFactoryPurchaseOrderDispatchOutbox } from "./factory-purchase-order-dispatch-notifications";
import { resolveFactoryPurchaseOrderDispatchRecipients } from "./factory-purchase-order-dispatch-recipients";

type AuditRequest = Parameters<typeof writeAudit>[0];

const ACTIVE_STATUSES = ["DISPATCHED", "ACCEPTED", "DELIVERY_PROPOSED"] as const;
const RETRYABLE_EMAIL_STATES = ["FAILED", "NO_RECIPIENT"];
const LEASE_MS = 5 * 60 * 1000;

export async function retryFactoryPurchaseOrderDispatchEmail(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const body = assertJsonObject(input);
  let recipientCount = 0;
  let missingRecipient = 0;
  let blockedReason = "";

  // Authorize the execution and target purchase order before taking any row
  // locks. The transaction repeats the checks after locking to prevent TOCTOU.
  const authorizedExecution = await loadSalesExecution(executionId, actor);
  await assertCustomerScope(actor, authorizedExecution.customerId);
  if (!authorizedExecution.purchaseOrders.some((order) => order.id === purchaseOrderId)) {
    throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  }

  try {
    await prisma.$transaction(async (tx) => {
      await lockSalesExecution(tx, executionId);
      await lockFactoryPurchaseOrders(tx, executionId);
      const execution = await loadSalesExecution(executionId, actor, tx);
      await assertCustomerScope(actor, execution.customerId, tx);
      assertExpectedSalesExecutionRevision(body, execution.revision);
      const order = execution.purchaseOrders.find((item) => item.id === purchaseOrderId);
      if (!order) throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      const version = Number(order.dispatchVersionNumber || 0);
      const expectedDispatchVersion = Number(body.dispatchVersionNumber || 0);
      if (
        execution.status !== "DISPATCHED"
        || !ACTIVE_STATUSES.includes(order.status as (typeof ACTIVE_STATUSES)[number])
        || !version
        || !Number.isSafeInteger(expectedDispatchVersion)
        || expectedDispatchVersion !== version
      ) {
        throw codedError("只有采购单自身的有效下发版本可以重试邮件", 409, "FACTORY_PURCHASE_ORDER_RETRY_INVALID");
      }
      if (!RETRYABLE_EMAIL_STATES.includes(String(order.dispatchEmailStatus || ""))) {
        throw codedError("当前邮件状态不需要人工重试", 409, "FACTORY_PURCHASE_ORDER_EMAIL_RETRY_NOT_REQUIRED");
      }

      const recipientResolution = await resolveFactoryPurchaseOrderDispatchRecipients(tx, order.supplierId);
      const recipients = recipientResolution.recipientEmails;
      recipientCount = recipients.length;
      missingRecipient = recipients.length ? 0 : 1;
      blockedReason = recipientResolution.blockedReason;
      const prefix = `factory-po-dispatch:${order.id}:v${version}:`;
      const currentKeys = recipients.map((email) => factoryDispatchIdempotencyKey(order.id, version, email));
      const freshSending = await tx.notificationOutbox.findFirst({
        where: {
          type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
          relatedEntityType: "factory_purchase_order",
          relatedEntityId: order.id,
          idempotencyKey: { startsWith: prefix },
          status: "sending",
          updatedAt: { gt: new Date(Date.now() - LEASE_MS) },
        },
        select: { id: true },
      });
      if (freshSending) {
        throw codedError("工厂采购单邮件正在发送，请稍后重试", 409, "FACTORY_PURCHASE_ORDER_EMAIL_SENDING");
      }

      await tx.notificationOutbox.updateMany({
        where: {
          type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
          relatedEntityType: "factory_purchase_order",
          relatedEntityId: order.id,
          idempotencyKey: { startsWith: prefix, ...(currentKeys.length ? { notIn: currentKeys } : {}) },
          status: { not: "sent" },
        },
        data: { status: "cancelled", lastError: "收件人快照已更新，旧通知任务失效" },
      });

      if (currentKeys.length) {
        await tx.notificationOutbox.updateMany({
          where: {
            type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
            relatedEntityType: "factory_purchase_order",
            relatedEntityId: order.id,
            idempotencyKey: { in: currentKeys },
            status: { not: "sent" },
          },
          data: {
            status: "queued",
            attempts: 0,
            scheduledAt: new Date(),
            sentAt: null,
            failedAt: null,
            lastError: null,
          },
        });
      }
      await tx.factoryPurchaseOrder.update({
        where: { id: order.id },
        data: {
          dispatchRecipientEmails: recipients,
          dispatchEmailStatus: recipients.length ? "NOT_SENT" : "NO_RECIPIENT",
          dispatchEmailSentAt: null,
          dispatchEmailError: recipients.length ? null : blockedReason,
          updatedById: actorId,
        },
      });
      if (recipients.length) {
        await queueFactoryPurchaseOrderDispatchOutbox(tx, execution.id, version, {
          purchaseOrderIds: [order.id],
        });
      }
      await writeAudit(
        request,
        { id: actorId },
        "人工重试工厂采购单邮件",
        "factory_purchase_orders",
        order.id,
        { dispatchEmailStatus: order.dispatchEmailStatus, recipientCount: Array.isArray(order.dispatchRecipientEmails) ? order.dispatchRecipientEmails.length : 0 },
        { dispatchEmailStatus: recipients.length ? "NOT_SENT" : "NO_RECIPIENT", recipientCount: recipients.length, dispatchVersionNumber: version },
        tx,
      );
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("邮件状态已变化，请刷新后重试", 409, "FACTORY_PURCHASE_ORDER_EMAIL_STATE_CONFLICT");
    }
    throw error;
  }

  if (!recipientCount) {
    throw codedError(
      `${blockedReason || "供应商未配置有效的采购门户账号邮箱"}，请先修正供应商资料`,
      409,
      "FACTORY_PURCHASE_ORDER_EMAIL_RECIPIENTS_UNAVAILABLE",
    );
  }

  const delivery = await processFactoryPurchaseOrderDispatchOutbox({
    limit: Math.min(50, recipientCount),
    purchaseOrderIds: [purchaseOrderId],
  }).catch(() => ({ scanned: 0, sent: 0, failed: 0, skipped: 0, queued: recipientCount, results: [] }));
  const execution = serializeSalesExecution(await loadSalesExecution(executionId, actor), true);
  return {
    execution,
    notificationSummary: {
      total: recipientCount,
      sent: delivery.sent,
      failed: delivery.failed,
      queued: delivery.queued,
      missingRecipient,
    },
    blockedReason: missingRecipient ? blockedReason : "",
  };
}
