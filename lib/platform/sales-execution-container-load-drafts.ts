import { Prisma } from "../generated/prisma/client.js";
import { assertWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import type { SalesExecutionActor } from "./sales-execution-access";
import { lockSalesExecution } from "./sales-execution-access";
import { requireActiveInternalConfirmationActor } from "./factory-purchase-order-confirmation-access";
import { lockContainerLoadingScope } from "./container-loading-locks";
import { normalizeContainerLoadCreateInput, normalizeContainerLoadUpdateInput } from "./sales-execution-container-load-inputs";
import {
  assertContainerExecutionOpen,
  assertContainerPlannedTotals,
  containerLoadDto,
  internalContainerLoadSelect,
  loadContainerAllocationTargets,
  lockContainerPurchaseOrders,
  runContainerMutation,
  scopedContainerExecution,
  scopedInternalContainerLoad,
} from "./sales-execution-container-load-core";

type AuditRequest = Parameters<typeof writeAudit>[0];

export async function createSalesExecutionContainerLoad(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  const input = normalizeContainerLoadCreateInput(rawInput);
  return runContainerMutation(async (tx) => {
    const validActor = await requireActiveInternalConfirmationActor(tx, actor);
    const visible = await scopedContainerExecution(tx, executionId, validActor);
    if (!visible) throw codedError("销售执行单不存在或无权访问", 404, "SALES_EXECUTION_NOT_FOUND");
    await lockSalesExecution(tx, executionId);
    const execution = await scopedContainerExecution(tx, executionId, validActor);
    if (!execution) throw codedError("销售执行单不存在或无权访问", 404, "SALES_EXECUTION_NOT_FOUND");
    assertContainerExecutionOpen(execution);
    if (execution.revision !== input.expectedRevision) {
      throw codedError("销售执行单已变化，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
    }
    const targets = await loadContainerAllocationTargets(tx, executionId, input.allocations);
    await lockContainerPurchaseOrders(tx, executionId, targets.map((target) => target.purchaseOrderId));
    await assertContainerPlannedTotals(tx, targets);
    const latest = await tx.salesExecutionContainerLoad.aggregate({ where: { executionId }, _max: { sequenceNo: true } });
    const container = await tx.salesExecutionContainerLoad.create({
      data: {
        executionId,
        sequenceNo: (latest._max.sequenceNo || 0) + 1,
        status: "DRAFT",
        containerNo: input.containerNo || null,
        containerType: input.containerType || null,
        sealNo: input.sealNo || null,
        loadingDate: input.loadingDate,
        allocations: {
          create: targets.map((target) => ({
            executionId,
            purchaseOrderId: target.purchaseOrderId,
            purchaseOrderItemId: target.purchaseOrderItemId,
            plannedQuantity: target.plannedQuantity,
          })),
        },
      },
      select: internalContainerLoadSelect,
    });
    const changed = await tx.salesExecution.updateMany({
      where: { id: executionId, revision: input.expectedRevision, shippingStartedAt: null },
      data: { revision: { increment: 1 }, updatedById: validActor.id },
    });
    if (changed.count !== 1) throw codedError("销售执行单已变化，请刷新后重试", 409, "SALES_EXECUTION_REVISION_CONFLICT");
    const result = containerLoadDto(container);
    await writeAudit(request, { id: validActor.id }, "创建集装箱装柜草稿", "sales_execution_container_loads", container.id, null, result, tx);
    return result;
  });
}

export async function updateSalesExecutionContainerLoad(
  request: AuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  containerLoadId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "salesExecution");
  const input = normalizeContainerLoadUpdateInput(rawInput);
  return runContainerMutation(async (tx) => {
    const validActor = await requireActiveInternalConfirmationActor(tx, actor);
    const visible = await scopedInternalContainerLoad(tx, executionId, containerLoadId, validActor);
    if (!visible) throw codedError("集装箱不存在或无权访问", 404, "CONTAINER_LOAD_NOT_FOUND");
    // Resolve new PO ids only as a preflight, then lock old + new POs before
    // result rows. Targets are reloaded after the locks for authoritative use.
    const preflightTargets = await loadContainerAllocationTargets(tx, executionId, input.allocations);
    await lockContainerLoadingScope(tx, executionId, containerLoadId, [
      ...visible.allocations.map((row) => row.purchaseOrderId),
      ...preflightTargets.map((row) => row.purchaseOrderId),
    ]);
    const execution = await scopedContainerExecution(tx, executionId, validActor);
    const before = await scopedInternalContainerLoad(tx, executionId, containerLoadId, validActor);
    if (!execution || !before) throw codedError("集装箱不存在或无权访问", 404, "CONTAINER_LOAD_NOT_FOUND");
    assertContainerExecutionOpen(execution);
    if (before.status !== "DRAFT") throw codedError("只有草稿集装箱可以修改", 409, "CONTAINER_LOAD_NOT_EDITABLE");
    if (before.revision !== input.expectedRevision) throw codedError("集装箱已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    const targets = await loadContainerAllocationTargets(tx, executionId, input.allocations);
    await assertContainerPlannedTotals(tx, targets, containerLoadId);
    await tx.containerLoadAllocation.deleteMany({ where: { containerLoadId } });
    const changed = await tx.salesExecutionContainerLoad.updateMany({
      where: { id: containerLoadId, executionId, status: "DRAFT", revision: input.expectedRevision },
      data: {
        containerNo: input.containerNo || null,
        containerType: input.containerType || null,
        sealNo: input.sealNo || null,
        loadingDate: input.loadingDate,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw codedError("集装箱已变化，请刷新后重试", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    await tx.containerLoadAllocation.createMany({
      data: targets.map((target) => ({
        containerLoadId, executionId,
        purchaseOrderId: target.purchaseOrderId,
        purchaseOrderItemId: target.purchaseOrderItemId,
        plannedQuantity: target.plannedQuantity,
      })),
    });
    const saved = await scopedInternalContainerLoad(tx, executionId, containerLoadId, validActor);
    if (!saved) throw codedError("集装箱保存失败", 409, "CONTAINER_LOAD_REVISION_CONFLICT");
    await writeAudit(request, { id: validActor.id }, "修改集装箱装柜草稿", "sales_execution_container_loads", containerLoadId, containerLoadDto(before), containerLoadDto(saved), tx);
    return containerLoadDto(saved);
  });
}
