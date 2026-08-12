import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import { resolveQuotationBusinessEntity } from "./quotation-seller-snapshot";
import type { SalesExecutionActor } from "./sales-execution-access";
import {
  assertExpectedSalesExecutionRevision,
  assertSalesExecutionDraft,
  lockFactoryPurchaseOrders,
  lockSalesExecution,
  requireSalesExecutionActorId,
} from "./sales-execution-access";
import { createDirectSalesExecution } from "./sales-execution-create-direct";
import { createSalesExecutionFromQuotation } from "./sales-execution-create-quotation";
import { buildDirectSalesExecutionItems, salesExecutionSubtotal } from "./sales-execution-direct-items";
import { assertSalesExecutionCanBeVoided } from "./sales-execution-lifecycle-guards";
import {
  applySalesExecutionItemWeightUpdates,
  prepareSalesExecutionItemWeightUpdates,
} from "./sales-execution-item-weights";
import {
  allocationsForExecutionLines,
  replaceFactoryPurchaseOrderRows,
} from "./sales-execution-purchase-orders";
import { loadSalesExecution } from "./sales-execution-query-service";
import {
  executionText,
  requiredCustomerOrderNo,
  requiredRequestedDeliveryDate,
  salesExecutionCurrency,
  salesExecutionDecimal,
  salesExecutionSource,
  serializeSalesExecution,
} from "./sales-execution-values";
import { appendSalesExecutionVersion } from "./sales-execution-version";
export { getSalesExecution, listSalesExecutions } from "./sales-execution-query-service";
type AuditRequest = Parameters<typeof writeAudit>[0];
type LooseRecord = Record<string, unknown>;
function own(input: LooseRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}
export async function createSalesExecution(
  request: AuditRequest,
  actor: SalesExecutionActor,
  input: unknown,
) {
  const body = assertJsonObject(input);
  return salesExecutionSource(body.sourceType) === "QUOTATION"
    ? createSalesExecutionFromQuotation(request, actor, body)
    : createDirectSalesExecution(request, actor, body);
}
export async function updateSalesExecution(
  request: AuditRequest,
  actor: SalesExecutionActor,
  id: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const body = assertJsonObject(input);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockSalesExecution(tx, id);
      const before = await loadSalesExecution(id, actor, tx);
      await assertCustomerScope(actor, before.customerId, tx);
      assertSalesExecutionDraft(before.status);
      assertExpectedSalesExecutionRevision(body, before.revision);
      const quotationWeightUpdates = prepareSalesExecutionItemWeightUpdates(
        before.sourceType,
        body,
        before.items,
      );

      const customerOrderNo = requiredCustomerOrderNo(
        own(body, "customerOrderNo") ? body.customerOrderNo : before.customerOrderNo,
      );
      const requestedDeliveryDate = requiredRequestedDeliveryDate(
        own(body, "requestedDeliveryDate")
          ? body.requestedDeliveryDate
          : before.requestedDeliveryDate,
      );

      let businessEntityId = before.businessEntityId;
      let businessEntityNameSnapshot = before.businessEntityNameSnapshot;
      let businessEntityShortNameSnapshot = before.businessEntityShortNameSnapshot;
      let currency = before.currency;
      let exchangeRate = before.exchangeRate;
      let subtotal = before.subtotal;
      let totalAmount = before.totalAmount;
      let replaceItems: Awaited<ReturnType<typeof buildDirectSalesExecutionItems>> | null = null;

      if (before.sourceType === "DIRECT") {
        const requestedCustomerId = own(body, "customerId")
          ? executionText(body.customerId, "客户", 100, true)
          : before.customerId;
        if (requestedCustomerId !== before.customerId) {
          throw codedError("销售执行单创建后不能更换客户，请新建执行单", 409, "SALES_EXECUTION_CUSTOMER_IMMUTABLE");
        }
        if (own(body, "businessEntityId")) {
          const entity = await resolveQuotationBusinessEntity(tx, body.businessEntityId);
          businessEntityId = entity.id;
          businessEntityNameSnapshot = entity.name;
          businessEntityShortNameSnapshot = entity.shortName;
        }
        currency = own(body, "currency") ? salesExecutionCurrency(body.currency) : before.currency;
        exchangeRate = own(body, "exchangeRate")
          ? salesExecutionDecimal(body.exchangeRate, "汇率", { positive: true, scale: 6, integerDigits: 12 })
          : before.exchangeRate;
        if (own(body, "items")) {
          replaceItems = await buildDirectSalesExecutionItems(
            tx,
            request,
            actorId,
            before.customerId,
            currency,
            body.items,
          );
          subtotal = salesExecutionSubtotal(replaceItems);
          totalAmount = subtotal;
          if (!own(body, "allocations")) {
            throw codedError(
              "修改销售明细时必须同时提交完整工厂分配",
              400,
              "PURCHASE_ALLOCATIONS_REQUIRED",
            );
          }
        }
      }

      if (replaceItems) {
        await tx.factoryPurchaseOrder.deleteMany({ where: { executionId: before.id } });
        await tx.salesExecutionItem.deleteMany({ where: { executionId: before.id } });
        await tx.salesExecutionItem.createMany({
          data: replaceItems.map((item) => ({ ...item, executionId: before.id })),
        });
      } else if (before.sourceType === "DIRECT" && currency !== before.currency) {
        await tx.salesExecutionItem.updateMany({
          where: { executionId: before.id },
          data: { currencySnapshot: currency },
        });
      }
      await applySalesExecutionItemWeightUpdates(tx, before.id, quotationWeightUpdates);

      const nextRevision = before.revision + 1;
      const changed = await tx.salesExecution.updateMany({
        where: { id: before.id, status: "DRAFT", revision: before.revision },
        data: {
          businessEntityId,
          businessEntityNameSnapshot,
          businessEntityShortNameSnapshot,
          currency,
          exchangeRate,
          tradeTerm: before.sourceType === "DIRECT" && own(body, "tradeTerm")
            ? executionText(body.tradeTerm, "贸易条款", 50) || null
            : before.tradeTerm,
          paymentTerm: before.sourceType === "DIRECT" && own(body, "paymentTerm")
            ? executionText(body.paymentTerm, "付款条款", 500) || null
            : before.paymentTerm,
          customerOrderNo,
          requestedDeliveryDate,
          subtotal,
          totalAmount,
          remark: own(body, "remark")
            ? executionText(body.remark, "备注", 5000) || null
            : before.remark,
          revision: nextRevision,
          currentVersionNumber: nextRevision,
          updatedById: actorId,
        },
      });
      if (changed.count !== 1) {
        throw codedError("销售执行单已被其他用户更新，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
      }
      if (own(body, "allocations")) {
        const executionWithItems = await loadSalesExecution(before.id, actor, tx);
        const allocations = replaceItems
          ? allocationsForExecutionLines(body.allocations, executionWithItems.items)
          : body.allocations;
        await replaceFactoryPurchaseOrderRows(tx, actorId, executionWithItems, allocations);
      }
      await appendSalesExecutionVersion(tx, before.id, actor);
      const saved = await loadSalesExecution(before.id, actor, tx);
      const serialized = serializeSalesExecution(saved, true);
      await writeAudit(
        request,
        { id: actorId },
        "更新销售执行单草稿并生成版本",
        "sales_executions",
        before.id,
        serializeSalesExecution(before, true),
        serialized,
        tx,
      );
      return serialized;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string } | null)?.code || ""))) {
      throw codedError("销售执行单已被其他用户更新，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
    }
    throw error;
  }
}

export async function voidSalesExecution(
  request: AuditRequest,
  actor: SalesExecutionActor,
  id: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const body = assertJsonObject(input);
  return prisma.$transaction(async (tx) => {
    await lockSalesExecution(tx, id);
    await lockFactoryPurchaseOrders(tx, id);
    const before = await loadSalesExecution(id, actor, tx);
    await assertCustomerScope(actor, before.customerId, tx);
    if (before.status === "VOIDED") return serializeSalesExecution(before, true);
    assertSalesExecutionCanBeVoided(before);
    assertExpectedSalesExecutionRevision(body, before.revision);
    const reason = executionText(body.reason ?? body.voidReason, "作废原因", 500) || "用户作废";
    const purchaseOrderIds = before.purchaseOrders.map((order) => order.id);
    if (purchaseOrderIds.length) {
      const [activePayments, activeAdjustments] = await Promise.all([
        tx.factoryPurchaseOrderPayment.count({ where: { purchaseOrderId: { in: purchaseOrderIds }, status: "CONFIRMED" } }),
        tx.factoryPurchaseOrderAdjustment.count({ where: { purchaseOrderId: { in: purchaseOrderIds }, status: { in: ["PROVISIONAL", "CONFIRMED"] } } }),
      ]);
      if (activePayments || activeAdjustments) {
        throw codedError("采购单已有有效付款或费用调整，请先完成冲销后再作废", 409, "SALES_EXECUTION_ACTIVE_FACTORY_LEDGER");
      }
    }
    const voidedAt = new Date();
    const nextRevision = before.revision + 1;
    const changed = await tx.salesExecution.updateMany({
      where: { id: before.id, status: { not: "VOIDED" }, revision: before.revision },
      data: {
        status: "VOIDED",
        voidedAt,
        voidedById: actorId,
        voidReason: reason,
        revision: nextRevision,
        currentVersionNumber: nextRevision,
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) {
      throw codedError("销售执行单状态已变化，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
    }
    if (purchaseOrderIds.length) {
      const activeDelivery = await tx.notificationOutbox.findFirst({
        where: {
          type: "FACTORY_PURCHASE_ORDER_DISPATCH",
          relatedEntityType: "factory_purchase_order",
          relatedEntityId: { in: purchaseOrderIds },
          status: "sending",
          updatedAt: { gt: new Date(Date.now() - 5 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (activeDelivery) {
        throw codedError(
          "工厂采购单邮件正在发送，请稍后再作废",
          409,
          "FACTORY_PURCHASE_ORDER_EMAIL_SENDING",
        );
      }
      await tx.notificationOutbox.updateMany({
        where: {
          type: "FACTORY_PURCHASE_ORDER_DISPATCH",
          relatedEntityType: "factory_purchase_order",
          relatedEntityId: { in: purchaseOrderIds },
          status: { in: ["queued", "failed", "pending", "sending"] },
        },
        data: { status: "cancelled", lastError: "销售执行单及工厂采购单已作废" },
      });
    }
    await tx.factoryPurchaseOrder.updateMany({
      where: { executionId: before.id, status: { not: "VOIDED" } },
      data: {
        status: "VOIDED",
        voidedAt,
        voidedById: actorId,
        voidReason: reason,
        revision: { increment: 1 },
        updatedById: actorId,
      },
    });
    await appendSalesExecutionVersion(tx, before.id, actor);
    const saved = await loadSalesExecution(before.id, actor, tx);
    const serialized = serializeSalesExecution(saved, true);
    await writeAudit(request, { id: actorId }, "作废销售执行单", "sales_executions", before.id, serializeSalesExecution(before, true), serialized, tx);
    return serialized;
  });
}
