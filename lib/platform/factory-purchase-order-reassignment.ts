import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertCustomerScope, assertWrite, codedError, writeAudit } from "./shared";
import {
  assertExpectedSalesExecutionRevision,
  lockFactoryPurchaseOrders,
  lockSalesExecution,
  requireSalesExecutionActorId,
  type SalesExecutionActor,
} from "./sales-execution-access";
import { factoryPurchaseOrderNumber } from "./sales-execution-number";
import { loadSalesExecution } from "./sales-execution-query-service";
import { serializeSalesExecution } from "./sales-execution-values";
import { appendSalesExecutionVersion } from "./sales-execution-version";
import {
  normalizeFactoryPurchaseOrderReassignmentInput,
  requireFactoryPurchaseOrderReplacementSupplier,
} from "./factory-purchase-order-reassignment-validation";
import { queueFactoryPurchaseOrderDispatchOutbox } from "./factory-purchase-order-dispatch-outbox";
import { retireRejectedPurchaseOrderNotifications } from "./factory-purchase-order-reassignment-notifications";
import { queueFactoryPurchaseOrderDispatchSmsOutbox } from "./factory-purchase-order-dispatch-sms-outbox";
import { processReplacementPurchaseOrderNotifications, summarizeReplacementPurchaseOrderNotifications, type ReplacementPurchaseOrderDispatchResult } from "./factory-purchase-order-reassignment-delivery";

type AuditRequest = Parameters<typeof writeAudit>[0];

export async function reassignRejectedFactoryPurchaseOrder(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const { body, newSupplierId, expectedOrderRevision } =
    normalizeFactoryPurchaseOrderReassignmentInput(input);

  const authorizedExecution = await loadSalesExecution(executionId, actor);
  await assertCustomerScope(actor, authorizedExecution.customerId);
  if (!authorizedExecution.purchaseOrders.some((order) => order.id === purchaseOrderId)) {
    throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  }

  let transactionResult: ReplacementPurchaseOrderDispatchResult;

  try {
    transactionResult = await prisma.$transaction(async (tx) => {
      await lockSalesExecution(tx, executionId);
      await lockFactoryPurchaseOrders(tx, executionId);
      const before = await loadSalesExecution(executionId, actor, tx);
      await assertCustomerScope(actor, before.customerId, tx);
      assertExpectedSalesExecutionRevision(body, before.revision);

      if (before.status !== "DISPATCHED") {
        throw codedError(
          "只有已下发的销售执行单可以重新分配被拒采购单",
          409,
          "FACTORY_PURCHASE_ORDER_REASSIGN_EXECUTION_INVALID",
        );
      }
      if (before.shippingStartedAt || before.receivableOrder) {
        throw codedError(
          "销售执行单已进入发货，不能重新分配工厂",
          409,
          "FACTORY_PURCHASE_ORDER_REASSIGN_SHIPPING_STARTED",
        );
      }

      const rejectedOrder = before.purchaseOrders.find((order) => order.id === purchaseOrderId);
      if (!rejectedOrder) {
        throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
      }
      if (rejectedOrder.status !== "REJECTED") {
        throw codedError(
          "只有已被供应商拒绝的采购单可以重新选厂",
          409,
          "FACTORY_PURCHASE_ORDER_REASSIGN_ORDER_NOT_REJECTED",
        );
      }
      if (rejectedOrder.revision !== expectedOrderRevision) {
        throw codedError(
          "采购单状态已变化，请刷新后重试",
          409,
          "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT",
        );
      }
      if (rejectedOrder.supplierId === newSupplierId) {
        throw codedError(
          "新工厂不能与已拒绝的原工厂相同",
          409,
          "FACTORY_PURCHASE_ORDER_REASSIGN_SAME_SUPPLIER",
        );
      }
      if (!rejectedOrder.items.length) {
        throw codedError(
          "被拒采购单没有可重新分配的明细",
          409,
          "FACTORY_PURCHASE_ORDER_REASSIGN_ITEMS_REQUIRED",
        );
      }
      if (before.purchaseOrders.some((order) => (
        order.id !== rejectedOrder.id
        && order.supplierId === newSupplierId
        && order.purchaseCurrency === rejectedOrder.purchaseCurrency
      ))) {
        throw codedError(
          "该工厂在当前销售执行单和采购币种下已有采购单",
          409,
          "FACTORY_PURCHASE_ORDER_REASSIGN_SUPPLIER_CONFLICT",
        );
      }

      const supplier = await requireFactoryPurchaseOrderReplacementSupplier(tx, newSupplierId);

      const now = new Date();
      await retireRejectedPurchaseOrderNotifications(tx, rejectedOrder.id, now);
      const nextRevision = before.revision + 1;
      const nextSequence = before.purchaseOrders.reduce(
        (maximum, order) => Math.max(maximum, order.sequenceNo),
        0,
      ) + 1;
      const replacementPoNo = factoryPurchaseOrderNumber(before.executionNo, nextSequence);

      const voided = await tx.factoryPurchaseOrder.updateMany({
        where: {
          id: rejectedOrder.id,
          executionId: before.id,
          status: "REJECTED",
          revision: expectedOrderRevision,
        },
        data: {
          status: "VOIDED",
          voidedAt: now,
          voidedById: actorId,
          voidReason: `供应商已拒绝，重新分配至 ${supplier.supplierName}`,
          dispatchEmailStatus: rejectedOrder.dispatchEmailStatus === "SENT" ? "SENT" : "CANCELLED",
          dispatchEmailError: rejectedOrder.dispatchEmailStatus === "SENT" ? rejectedOrder.dispatchEmailError : "原通知已取消",
          revision: { increment: 1 },
          updatedById: actorId,
        },
      });
      if (voided.count !== 1) {
        throw codedError(
          "采购单状态已变化，请刷新后重试",
          409,
          "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT",
        );
      }

      const replacement = await tx.factoryPurchaseOrder.create({
        data: {
          executionId: before.id,
          sequenceNo: nextSequence,
          poNo: replacementPoNo,
          supplierId: supplier.id,
          supplierNameSnapshot: supplier.supplierName,
          replacementForId: rejectedOrder.id,
          status: "DRAFT",
          purchaseCurrency: rejectedOrder.purchaseCurrency,
          subtotal: null,
          requestedDeliveryDate: rejectedOrder.requestedDeliveryDate,
          paymentTerm: supplier.purchasePaymentTerm,
          prepaymentRatio: supplier.purchasePrepaymentRatio,
          prepaymentRequiredBeforeProduction:
            supplier.purchasePrepaymentRatio.gt(0)
            && supplier.purchasePrepaymentRequiredBeforeProduction,
          deliveryQuantityToleranceRatio: supplier.purchaseQuantityToleranceRatio,
          delayGraceDays: rejectedOrder.delayGraceDays,
          delayPenaltyRatePerDay: rejectedOrder.delayPenaltyRatePerDay,
          delayPenaltyCapRatio: rejectedOrder.delayPenaltyCapRatio,
          remark: rejectedOrder.remark,
          createdById: actorId,
          updatedById: actorId,
          items: {
            create: rejectedOrder.items.map((item) => ({
              executionId: before.id,
              executionItemId: item.executionItemId,
              lineNumber: item.lineNumber,
              productNameSnapshot: item.productNameSnapshot,
              specificationSnapshot: item.specificationSnapshot,
              unitSnapshot: item.unitSnapshot,
              allocatedQuantity: item.allocatedQuantity,
              purchaseUnitPrice: null,
              amount: null,
              remark: item.remark,
            })),
          },
        },
      });

      const dispatched = await tx.factoryPurchaseOrder.updateMany({
        where: { id: replacement.id, executionId: before.id, status: "DRAFT", revision: 1 },
        data: {
          status: "DISPATCHED",
          dispatchedAt: now,
          dispatchedById: actorId,
          dispatchVersionNumber: nextRevision,
          dispatchEmailStatus: "NOT_SENT",
          dispatchSmsStatus: "NOT_SENT",
          revision: { increment: 1 },
          updatedById: actorId,
        },
      });
      if (dispatched.count !== 1) {
        throw codedError(
          "新采购单状态已变化，请刷新后重试",
          409,
          "FACTORY_PURCHASE_ORDER_REASSIGN_CONFLICT",
        );
      }

      const executionChanged = await tx.salesExecution.updateMany({
        where: {
          id: before.id,
          status: "DISPATCHED",
          revision: before.revision,
          shippingStartedAt: null,
        },
        data: {
          dispatchedVersionNumber: nextRevision,
          revision: nextRevision,
          currentVersionNumber: nextRevision,
          updatedById: actorId,
        },
      });
      if (executionChanged.count !== 1) {
        throw codedError(
          "销售执行单状态已变化，请刷新后重试",
          409,
          "SALES_EXECUTION_REVISION_CONFLICT",
        );
      }

      const queued = await queueFactoryPurchaseOrderDispatchOutbox(tx, before.id, nextRevision, {
        purchaseOrderIds: [replacement.id],
      });
      const queuedSms = await queueFactoryPurchaseOrderDispatchSmsOutbox(tx, before.id, nextRevision, {
        purchaseOrderIds: [replacement.id],
      });
      await appendSalesExecutionVersion(tx, before.id, actor);
      const saved = await loadSalesExecution(before.id, actor, tx);
      await writeAudit(
        request,
        { id: actorId },
        "被拒工厂采购单重新选厂并单独下发",
        "sales_executions",
        before.id,
        serializeSalesExecution(before, true),
        serializeSalesExecution(saved, true),
        tx,
      );
      return {
        replacementPurchaseOrderId: replacement.id,
        queued: queued.queued,
        missingRecipient: queued.missingRecipient,
        queuedSms: queuedSms.queued,
        missingSmsRecipient: queuedSms.missingRecipient,
        disabledSms: queuedSms.disabled,
        smsConfigurationError: queuedSms.configurationError,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    const code = String((error as { code?: string } | null)?.code || "");
    if (code === "P2002") {
      throw codedError(
        "重新选厂生成采购单发生编号或供应商冲突，请刷新后重试",
        409,
        "FACTORY_PURCHASE_ORDER_REASSIGN_CONFLICT",
      );
    }
    if (code === "P2034") {
      throw codedError(
        "销售执行单刚刚被其他操作更新，请刷新后重试",
        409,
        "SALES_EXECUTION_REVISION_CONFLICT",
      );
    }
    throw error;
  }

  const deliveries = await processReplacementPurchaseOrderNotifications({
    purchaseOrderId: transactionResult.replacementPurchaseOrderId,
    queuedEmail: transactionResult.queued,
    queuedSms: transactionResult.queuedSms,
  });
  const execution = serializeSalesExecution(await loadSalesExecution(executionId, actor), true);
  const notificationSummaries = summarizeReplacementPurchaseOrderNotifications(deliveries, {
    missingEmail: transactionResult.missingRecipient,
    missingSms: transactionResult.missingSmsRecipient,
    disabledSms: transactionResult.disabledSms,
    smsConfigurationError: transactionResult.smsConfigurationError,
  });
  return {
    execution,
    replacementPurchaseOrderId: transactionResult.replacementPurchaseOrderId,
    ...notificationSummaries,
  };
}
