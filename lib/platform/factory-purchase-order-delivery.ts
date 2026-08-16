import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import {
  effectiveFactoryPurchaseOrderAmount,
  factoryPrepaymentRequiredAmount,
} from "./factory-purchase-order-financials";
import {
  lockFactoryPurchaseOrder,
  requireSalesExecutionActorId,
  salesExecutionAccessWhere,
  type SalesExecutionActor,
} from "./sales-execution-access";
import { todayInChina } from "./quotation-date-values";
import {
  normalizeDeliveryProposalDecisionInput,
} from "./factory-purchase-order-delivery-inputs";

export {
  normalizeActualDeliveryInput,
  normalizeDeliveryProposalDecisionInput,
} from "./factory-purchase-order-delivery-inputs";
export { recordFactoryPurchaseOrderActualDelivery } from "./factory-purchase-order-actual-delivery";

type AuditRequest = Parameters<typeof writeAudit>[0];
async function loadDeliveryOrder(
  tx: Prisma.TransactionClient,
  executionId: string,
  purchaseOrderId: string,
  actor: SalesExecutionActor,
) {
  const order = await tx.factoryPurchaseOrder.findFirst({
    where: {
      id: nonEmpty(purchaseOrderId),
      executionId: nonEmpty(executionId),
      execution: { is: salesExecutionAccessWhere(actor) },
    },
    include: {
      items: { include: { supplierPrice: true }, orderBy: [{ lineNumber: "asc" }] },
      payments: { orderBy: [{ sequenceNo: "asc" }] },
      supplierResponses: { orderBy: [{ responseSequence: "desc" }], take: 1 },
      execution: { select: { shippingStartedAt: true } },
    },
  });
  if (!order) throw codedError("工厂采购单不存在或无权访问", 404, "FACTORY_PURCHASE_ORDER_NOT_FOUND");
  return order;
}

type DeliveryOrder = Awaited<ReturnType<typeof loadDeliveryOrder>>;

function confirmedPrepaymentTotal(order: DeliveryOrder) {
  const today = todayInChina().getTime();
  return order.payments
    .filter((payment) => payment.status === "CONFIRMED" && payment.kind === "PREPAYMENT" && payment.paidAt.getTime() <= today)
    .reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0))
    .toDecimalPlaces(2);
}

function deliveryState(order: DeliveryOrder) {
  const response = order.supplierResponses[0] || null;
  return {
    id: order.id,
    executionId: order.executionId,
    revision: order.revision,
    status: order.status,
    productionStatus: order.productionStatus,
    supplierDeliveryDate: order.supplierDeliveryDate,
    confirmedSupplierDeliveryDate: order.confirmedSupplierDeliveryDate,
    initialSupplierDeliveryDate: order.initialSupplierDeliveryDate,
    penaltyBaseAmount: order.penaltyBaseAmount?.toString() || null,
    actualDeliveryDate: order.actualDeliveryDate,
    actualDeliveryRecordedAt: order.actualDeliveryRecordedAt,
    actualDeliveryRecordedById: order.actualDeliveryRecordedById,
    latestSupplierResponse: response ? {
      id: response.id,
      responseSequence: response.responseSequence,
      action: response.action,
      deliveryDate: response.deliveryDate,
      internalDecision: response.internalDecision,
      internalDecisionRemark: response.internalDecisionRemark,
      internalDecidedAt: response.internalDecidedAt,
      internalDecidedById: response.internalDecidedById,
    } : null,
  };
}

function decisionAuditState(order: DeliveryOrder) {
  const response = order.supplierResponses[0] || null;
  return {
    revision: order.revision,
    status: order.status,
    confirmedSupplierDeliveryDate: order.confirmedSupplierDeliveryDate,
    initialSupplierDeliveryDate: order.initialSupplierDeliveryDate,
    penaltyBaseAmount: order.penaltyBaseAmount?.toString() || null,
    productionStatus: order.productionStatus,
    latestSupplierResponse: response ? {
      id: response.id,
      responseSequence: response.responseSequence,
      internalDecision: response.internalDecision,
      internalDecisionRemark: response.internalDecisionRemark,
      internalDecidedAt: response.internalDecidedAt,
      internalDecidedById: response.internalDecidedById,
    } : null,
  };
}

export async function decideFactoryPurchaseOrderDeliveryProposal(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const input = normalizeDeliveryProposalDecisionInput(rawInput);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockFactoryPurchaseOrder(tx, purchaseOrderId);
      const before = await loadDeliveryOrder(tx, executionId, purchaseOrderId, actor);
      const proposal = before.supplierResponses[0];
      if (before.status !== "DELIVERY_PROPOSED" || !proposal || proposal.action !== "DELIVERY_PROPOSED"
        || proposal.responseSequence !== before.supplierResponseSequence) {
        throw codedError("当前没有待确认的最新供应商交期提议", 409, "FACTORY_DELIVERY_PROPOSAL_NOT_PENDING");
      }
      if (proposal.internalDecision) {
        throw codedError("该供应商交期提议已经处理", 409, "FACTORY_DELIVERY_PROPOSAL_ALREADY_DECIDED");
      }
      if (before.revision !== input.expectedRevision) {
        throw codedError("采购单状态已变化，请刷新后重试", 409, "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT");
      }
      if (!proposal.deliveryDate) {
        throw codedError("供应商交期提议缺少日期", 409, "FACTORY_DELIVERY_PROPOSAL_DATE_MISSING");
      }
      if (before.productionStatus === "COMPLETED" || before.actualDeliveryDate || before.execution.shippingStartedAt) {
        throw codedError("采购单已经完工或进入交付，交期已冻结", 409, "FACTORY_DELIVERY_FROZEN");
      }

      const decidedAt = new Date();
      const responseChanged = await tx.factoryPurchaseOrderSupplierResponse.updateMany({
        where: { id: proposal.id, purchaseOrderId: before.id, internalDecision: null },
        data: {
          internalDecision: input.decision,
          internalDecisionRemark: input.remark || null,
          internalDecidedAt: decidedAt,
          internalDecidedById: actorId,
        },
      });
      if (responseChanged.count !== 1) {
        throw codedError("供应商交期提议已被其他用户处理", 409, "FACTORY_DELIVERY_PROPOSAL_DECISION_CONFLICT");
      }

      const firstConfirmation = input.decision === "ACCEPTED" && !before.confirmedSupplierDeliveryDate;
      const penaltyBaseAmount = firstConfirmation ? effectiveFactoryPurchaseOrderAmount(before.items) : before.penaltyBaseAmount;
      if (firstConfirmation && penaltyBaseAmount === null) {
        throw codedError("采购单金额尚未完整，不能确认供应商交期", 409, "FACTORY_PURCHASE_ORDER_PENALTY_BASE_INCOMPLETE");
      }
      const requiredPrepayment = factoryPrepaymentRequiredAmount(penaltyBaseAmount, before.prepaymentRatio);
      const productionStatus = before.prepaymentRequiredBeforeProduction
        && confirmedPrepaymentTotal(before).lt(requiredPrepayment)
        ? "WAITING_PREPAYMENT"
        : "READY";
      const nextStatus = input.decision === "ACCEPTED"
        ? "ACCEPTED"
        : before.confirmedSupplierDeliveryDate ? "ACCEPTED" : "DISPATCHED";
      const changed = await tx.factoryPurchaseOrder.updateMany({
        where: {
          id: before.id,
          executionId: before.executionId,
          status: "DELIVERY_PROPOSED",
          supplierResponseSequence: proposal.responseSequence,
          revision: input.expectedRevision,
        },
        data: {
          status: nextStatus,
          supplierDeliveryDate: input.decision === "ACCEPTED" ? proposal.deliveryDate : before.confirmedSupplierDeliveryDate,
          ...(input.decision === "ACCEPTED" ? { confirmedSupplierDeliveryDate: proposal.deliveryDate } : {}),
          ...(firstConfirmation ? {
            initialSupplierDeliveryDate: proposal.deliveryDate,
            penaltyBaseAmount,
            productionStatus,
          } : {}),
          ...(input.decision === "REJECTED" && !before.confirmedSupplierDeliveryDate
            ? { productionStatus: "WAITING_SUPPLIER" }
            : {}),
          revision: { increment: 1 },
          updatedById: actorId,
        },
      });
      if (changed.count !== 1) {
        throw codedError("采购单状态已变化，请刷新后重试", 409, "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT");
      }
      const saved = await loadDeliveryOrder(tx, executionId, before.id, actor);
      await writeAudit(
        request,
        { id: actorId },
        input.decision === "ACCEPTED" ? "接受供应商新交期" : "拒绝供应商新交期",
        "factory_purchase_orders",
        before.id,
        decisionAuditState(before),
        decisionAuditState(saved),
        tx,
      );
      return { decision: input.decision, purchaseOrder: deliveryState(saved) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT");
    }
    throw error;
  }
}
