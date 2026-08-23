import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import type { SalesExecutionActor } from "./sales-execution-access";
import {
  assertExpectedSalesExecutionRevision,
  lockFactoryPurchaseOrders,
  lockSalesExecution,
  requireSalesExecutionActorId,
} from "./sales-execution-access";
import { getSalesExecution, loadSalesExecution } from "./sales-execution-query-service";
import { serializeSalesExecution } from "./sales-execution-values";
import { appendSalesExecutionVersion } from "./sales-execution-version";
import { queueFactoryPurchaseOrderDispatchOutbox } from "./factory-purchase-order-dispatch-outbox";
import { processFactoryPurchaseOrderDispatchOutbox } from "./factory-purchase-order-dispatch-notifications";
import { queueFactoryPurchaseOrderDispatchSmsOutbox } from "./factory-purchase-order-dispatch-sms-outbox";
import { processFactoryPurchaseOrderDispatchSmsOutbox } from "./factory-purchase-order-dispatch-sms-notifications";
import { PRODUCT_SUPPLIER_TYPES } from "./shared-party-constants";

type AuditRequest = Parameters<typeof writeAudit>[0];
type LoadedExecution = Awaited<ReturnType<typeof loadSalesExecution>>;

function validateDispatchReadiness(execution: LoadedExecution) {
  if (!execution.items.length) {
    throw codedError("销售执行单没有可下发的产品明细", 409, "SALES_EXECUTION_ITEMS_REQUIRED");
  }
  if (!execution.purchaseOrders.length) {
    throw codedError("请先完成工厂采购分配后再下发", 409, "FACTORY_PURCHASE_ORDERS_REQUIRED");
  }
  const totals = new Map<string, Prisma.Decimal>();
  for (const order of execution.purchaseOrders) {
    if (order.status !== "DRAFT") {
      throw codedError("工厂采购单状态已变化，请刷新后重试", 409, "FACTORY_PURCHASE_ORDER_STATE_CONFLICT");
    }
    if (!order.requestedDeliveryDate || !order.items.length) {
      throw codedError("每张工厂采购单都必须包含产品和要求交货日期", 409, "FACTORY_PURCHASE_ORDER_INCOMPLETE");
    }
    for (const item of order.items) {
      totals.set(
        item.executionItemId,
        (totals.get(item.executionItemId) || new Prisma.Decimal(0)).add(item.allocatedQuantity),
      );
    }
  }
  for (const item of execution.items) {
    if (!(totals.get(item.id) || new Prisma.Decimal(0)).eq(item.quantity)) {
      throw codedError(
        "每条销售明细必须完成全部工厂分配后才能下发",
        409,
        "PURCHASE_ALLOCATION_NOT_EXACT",
      );
    }
  }
}

async function assertActivePurchaseOrderSuppliers(
  tx: Prisma.TransactionClient,
  execution: LoadedExecution,
) {
  const supplierIds = [...new Set(execution.purchaseOrders.map((order) => order.supplierId))];
  const activeSuppliers = await tx.supplier.count({
    where: {
      id: { in: supplierIds },
      deletedAt: null,
      status: "启用",
      supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
    },
  });
  if (activeSuppliers !== supplierIds.length) {
    throw codedError(
      "采购单包含已停用、已删除或非产品供应商的工厂，请返回草稿重新选择",
      409,
      "PURCHASE_SUPPLIER_INVALID",
    );
  }
}

export async function dispatchSalesExecution(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const body = assertJsonObject(input);
  let transactionResult: {
    execution: ReturnType<typeof serializeSalesExecution>;
    newlyDispatched: boolean;
    dispatchVersionNumber: number;
    purchaseOrderIds: string[];
    queuedNotifications: number;
    missingRecipient: number;
    queuedSmsNotifications: number;
    missingSmsRecipient: number;
    disabledSms: number;
    smsConfigurationError: number;
  };
  try {
    transactionResult = await prisma.$transaction(async (tx) => {
      await lockSalesExecution(tx, executionId);
      await lockFactoryPurchaseOrders(tx, executionId);
      const before = await loadSalesExecution(executionId, actor, tx);
      await assertCustomerScope(actor, before.customerId, tx);
      if (before.status === "VOIDED") {
        throw codedError("已作废的销售执行单不能下发", 409, "SALES_EXECUTION_VOIDED");
      }
      if (before.status === "DISPATCHED") {
        const dispatchVersionNumber = before.dispatchedVersionNumber || before.currentVersionNumber;
        const queued = await queueFactoryPurchaseOrderDispatchOutbox(
          tx,
          before.id,
          dispatchVersionNumber,
        );
        const queuedSms = await queueFactoryPurchaseOrderDispatchSmsOutbox(
          tx,
          before.id,
          dispatchVersionNumber,
        );
        return {
          execution: serializeSalesExecution(before, true),
          newlyDispatched: false,
          dispatchVersionNumber,
          purchaseOrderIds: queued.purchaseOrderIds,
          queuedNotifications: queued.queued,
          missingRecipient: queued.missingRecipient,
          queuedSmsNotifications: queuedSms.queued,
          missingSmsRecipient: queuedSms.missingRecipient,
          disabledSms: queuedSms.disabled,
          smsConfigurationError: queuedSms.configurationError,
        };
      }
      assertExpectedSalesExecutionRevision(body, before.revision);
      validateDispatchReadiness(before);
      await assertActivePurchaseOrderSuppliers(tx, before);

      const dispatchedAt = new Date();
      const nextRevision = before.revision + 1;
      const executionChanged = await tx.salesExecution.updateMany({
        where: { id: before.id, status: "DRAFT", revision: before.revision },
        data: {
          status: "DISPATCHED",
          dispatchedAt,
          dispatchedById: actorId,
          dispatchedVersionNumber: nextRevision,
          revision: nextRevision,
          currentVersionNumber: nextRevision,
          updatedById: actorId,
        },
      });
      if (executionChanged.count !== 1) {
        throw codedError("销售执行单状态已变化，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
      }
      const ordersChanged = await tx.factoryPurchaseOrder.updateMany({
        where: { executionId: before.id, status: "DRAFT" },
        data: {
          status: "DISPATCHED",
          dispatchedAt,
          dispatchedById: actorId,
          dispatchVersionNumber: nextRevision,
          dispatchEmailStatus: "NOT_SENT",
          dispatchSmsStatus: "NOT_SENT",
          revision: { increment: 1 },
          updatedById: actorId,
        },
      });
      if (ordersChanged.count !== before.purchaseOrders.length) {
        throw codedError("部分工厂采购单状态已变化，请刷新后重试", 409, "FACTORY_PURCHASE_ORDER_STATE_CONFLICT");
      }
      const queued = await queueFactoryPurchaseOrderDispatchOutbox(tx, before.id, nextRevision);
      const queuedSms = await queueFactoryPurchaseOrderDispatchSmsOutbox(tx, before.id, nextRevision);
      await appendSalesExecutionVersion(tx, before.id, actor);
      const saved = await loadSalesExecution(before.id, actor, tx);
      const serialized = serializeSalesExecution(saved, true);
      await writeAudit(
        request,
        { id: actorId },
        "正式下发销售执行单及工厂采购单",
        "sales_executions",
        before.id,
        serializeSalesExecution(before, true),
        { ...serialized, dispatchAttachments: queued.attachmentSnapshots },
        tx,
      );
      return {
        execution: serialized,
        newlyDispatched: true,
        dispatchVersionNumber: nextRevision,
        purchaseOrderIds: queued.purchaseOrderIds,
        queuedNotifications: queued.queued,
        missingRecipient: queued.missingRecipient,
        queuedSmsNotifications: queuedSms.queued,
        missingSmsRecipient: queuedSms.missingRecipient,
        disabledSms: queuedSms.disabled,
        smsConfigurationError: queuedSms.configurationError,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string } | null)?.code || ""))) {
      throw codedError("销售执行单状态已变化，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
    }
    throw error;
  }

  let delivery = {
    scanned: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    queued: transactionResult.queuedNotifications,
    results: [] as Array<unknown>,
  };
  let smsDelivery = {
    scanned: 0,
    submitted: 0,
    failed: 0,
    unknown: 0,
    skipped: 0,
    queued: transactionResult.queuedSmsNotifications,
    results: [] as Array<unknown>,
  };
  const [emailDeliveryResult, smsDeliveryResult] = await Promise.allSettled([
    processFactoryPurchaseOrderDispatchOutbox({
      limit: 4,
      purchaseOrderIds: transactionResult.purchaseOrderIds,
    }),
    processFactoryPurchaseOrderDispatchSmsOutbox({
      limit: 1,
      purchaseOrderIds: transactionResult.purchaseOrderIds,
    }),
  ]);
  if (emailDeliveryResult.status === "fulfilled") delivery = emailDeliveryResult.value;
  if (smsDeliveryResult.status === "fulfilled") smsDelivery = smsDeliveryResult.value;
  const notificationSummary = {
    total: transactionResult.purchaseOrderIds.length,
    sent: delivery.sent,
    failed: delivery.failed,
    queued: delivery.queued,
    missingRecipient: transactionResult.missingRecipient,
  };
  const execution = await getSalesExecution(executionId, actor);
  const smsNotificationSummary = {
    total: transactionResult.purchaseOrderIds.length,
    submitted: smsDelivery.submitted,
    failed: smsDelivery.failed,
    unknown: smsDelivery.unknown,
    queued: smsDelivery.queued,
    missingRecipient: transactionResult.missingSmsRecipient,
    disabled: transactionResult.disabledSms,
    configurationError: transactionResult.smsConfigurationError,
  };
  return {
    execution,
    notificationSummary,
    smsNotificationSummary,
    newlyDispatched: transactionResult.newlyDispatched,
  };
}
