import { Prisma } from "../generated/prisma/client.js";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import type { SalesExecutionActor } from "./sales-execution-access";
import { requireActiveInternalConfirmationActor } from "./factory-purchase-order-confirmation-access";
import { lockContainerLoadingScope } from "./container-loading-locks";
import { shanghaiDateText } from "./factory-purchase-order-delivery-inputs";
import {
  normalizeContainerLoadOpenInput,
  normalizeContainerLoadReleaseInput,
  normalizeContainerLoadVoidInput,
} from "./sales-execution-container-load-inputs";
import {
  assertContainerExecutionOpen,
  containerLoadDto,
  runContainerMutation,
  scopedContainerExecution,
  scopedInternalContainerLoad,
  type InternalContainerLoad,
} from "./sales-execution-container-load-core";

type AuditRequest = Parameters<typeof writeAudit>[0];

async function lockedContainerContext(
  tx: Prisma.TransactionClient,
  actor: SalesExecutionActor,
  executionId: string,
  containerLoadId: string,
) {
  const visible = await scopedInternalContainerLoad(tx, executionId, containerLoadId, actor);
  if (!visible) throw codedError("集装箱不存在或无权访问", 404, "CONTAINER_LOAD_NOT_FOUND");
  await lockContainerLoadingScope(tx, executionId, containerLoadId, visible.allocations.map((row) => row.purchaseOrderId));
  const execution = await scopedContainerExecution(tx, executionId, actor);
  const container = await scopedInternalContainerLoad(tx, executionId, containerLoadId, actor);
  if (!execution || !container) throw codedError("集装箱不存在或无权访问", 404, "CONTAINER_LOAD_NOT_FOUND");
  assertContainerExecutionOpen(execution);
  return { execution, container };
}

export async function openSalesExecutionContainerLoad(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  containerLoadId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  const input = normalizeContainerLoadOpenInput(rawInput);
  return runContainerMutation(async (tx) => {
    const validActor = await requireActiveInternalConfirmationActor(tx, actor);
    const { container: before } = await lockedContainerContext(tx, validActor, executionId, containerLoadId);
    if (before.status !== "DRAFT" || before.revision !== input.expectedRevision) {
      throw codedError("只有当前版本的草稿集装箱可以开放", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    }
    if (!before.containerNo || !before.loadingDate || !before.allocations.length) {
      throw codedError("开放前必须填写柜号、装柜日期并完成采购明细分配", 409, "CONTAINER_LOAD_OPEN_FIELDS_REQUIRED");
    }
    const poIds = [...new Set(before.allocations.map((row) => row.purchaseOrderId))];
    const eligible = await tx.factoryPurchaseOrder.count({
      where: { id: { in: poIds }, executionId, status: "ACCEPTED", dispatchedAt: { not: null } },
    });
    if (eligible !== poIds.length) {
      throw codedError("本柜包含尚未内部确认交期的采购单，不能开放", 409, "CONTAINER_LOAD_PURCHASE_ORDER_NOT_ACCEPTED");
    }
    const changed = await tx.salesExecutionContainerLoad.updateMany({
      where: { id: containerLoadId, executionId, status: "DRAFT", revision: input.expectedRevision },
      data: { status: "OPEN", revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw codedError("集装箱已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    const saved = await scopedInternalContainerLoad(tx, executionId, containerLoadId, validActor);
    if (!saved) throw codedError("集装箱开放失败", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    await writeAudit(request, { id: validActor.id }, "开放集装箱供应商装柜填报", "sales_execution_container_loads", containerLoadId, containerLoadDto(before), containerLoadDto(saved), tx);
    return containerLoadDto(saved);
  });
}

function assertReleaseResults(before: InternalContainerLoad) {
  if (before.loadingResults.some((result) => result.status === "PENDING")) {
    throw codedError("本柜仍有待审批装柜差异，不能放行", 409, "CONTAINER_LOAD_PENDING_RESULT");
  }
  const poIds = [...new Set(before.allocations.map((allocation) => allocation.purchaseOrderId))];
  const approvedByPo = new Map(before.loadingResults
    .filter((result) => result.status === "APPROVED")
    .map((result) => [result.purchaseOrderId, result]));
  if (poIds.some((purchaseOrderId) => !approvedByPo.has(purchaseOrderId))) {
    throw codedError("本柜仍有供应商采购槽位未批准装柜结果", 409, "CONTAINER_LOAD_SLOT_NOT_APPROVED");
  }
  for (const purchaseOrderId of poIds) {
    const allocationIds = before.allocations.filter((row) => row.purchaseOrderId === purchaseOrderId)
      .map((row) => row.purchaseOrderItemId).sort();
    const resultIds = (approvedByPo.get(purchaseOrderId)?.items || [])
      .map((item) => item.purchaseOrderItemId).sort();
    if (allocationIds.length !== resultIds.length || allocationIds.some((id, index) => id !== resultIds[index])) {
      throw codedError("批准装柜结果未完整覆盖本柜分配", 409, "CONTAINER_LOAD_RESULT_INCOMPLETE");
    }
  }
  const totalLoaded = [...approvedByPo.values()].reduce(
    (sum, result) => result.items.reduce((inner, item) => inner.add(item.loadedQuantity), sum),
    new Prisma.Decimal(0),
  );
  if (!totalLoaded.gt(0)) throw codedError("整柜实际装柜数量必须大于 0", 409, "CONTAINER_LOAD_TOTAL_REQUIRED");
}

export async function releaseSalesExecutionContainerLoad(
  request: AuditRequest, actor: SalesExecutionActor, executionId: string,
  containerLoadId: string, rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  const input = normalizeContainerLoadReleaseInput(rawInput);
  return runContainerMutation(async (tx) => {
    const validActor = await requireActiveInternalConfirmationActor(tx, actor);
    const { container: before } = await lockedContainerContext(tx, validActor, executionId, containerLoadId);
    if (before.status !== "OPEN" || before.revision !== input.expectedRevision) {
      throw codedError("只有当前版本的开放集装箱可以放行", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    }
    if (!before.loadingDate || before.loadingDate.toISOString().slice(0, 10) > shanghaiDateText(new Date())) {
      throw codedError("装柜日期不能晚于今天", 400, "CONTAINER_LOAD_DATE_IN_FUTURE");
    }
    assertReleaseResults(before);
    const now = new Date();
    const changed = await tx.salesExecutionContainerLoad.updateMany({
      where: { id: containerLoadId, executionId, status: "OPEN", revision: input.expectedRevision },
      data: {
        status: "RELEASED", releasedAt: now, releasedById: validActor.id,
        releaseRemark: input.remark || null, revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw codedError("集装箱已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    const saved = await scopedInternalContainerLoad(tx, executionId, containerLoadId, validActor);
    if (!saved) throw codedError("集装箱放行失败", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    await writeAudit(request, { id: validActor.id }, "放行集装箱", "sales_execution_container_loads", containerLoadId, containerLoadDto(before), containerLoadDto(saved), tx);
    return containerLoadDto(saved);
  });
}

export async function voidSalesExecutionContainerLoad(
  request: AuditRequest, actor: SalesExecutionActor, executionId: string,
  containerLoadId: string, rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  const input = normalizeContainerLoadVoidInput(rawInput);
  return runContainerMutation(async (tx) => {
    const validActor = await requireActiveInternalConfirmationActor(tx, actor);
    const { container: before } = await lockedContainerContext(tx, validActor, executionId, containerLoadId);
    if (!(["DRAFT", "OPEN"] as string[]).includes(before.status)) {
      throw codedError("已放行或已作废的集装箱不能再作废", 409, "CONTAINER_LOAD_NOT_VOIDABLE");
    }
    if (before.revision !== input.expectedRevision) {
      throw codedError("集装箱已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    }
    if (before.loadingResults.some((result) => result.status === "PENDING" || result.status === "APPROVED")) {
      throw codedError("本柜已有待审批或已批准装柜结果，不能作废", 409, "CONTAINER_LOAD_RESULT_EXISTS");
    }
    const now = new Date();
    const changed = await tx.salesExecutionContainerLoad.updateMany({
      where: { id: containerLoadId, executionId, status: before.status, revision: input.expectedRevision },
      data: {
        status: "VOIDED", voidedAt: now, voidedById: validActor.id,
        voidReason: input.reason, revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw codedError("集装箱已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    const saved = await scopedInternalContainerLoad(tx, executionId, containerLoadId, validActor);
    if (!saved) throw codedError("集装箱作废失败", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    await writeAudit(request, { id: validActor.id }, "作废集装箱", "sales_execution_container_loads", containerLoadId, containerLoadDto(before), containerLoadDto(saved), tx);
    return containerLoadDto(saved);
  });
}
