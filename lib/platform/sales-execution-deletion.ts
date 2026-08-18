import { prisma } from "../prisma";
import { FILE_ASSET_SOURCE_TABLES } from "./file-asset-data";
import { enqueueFileStorageDeletion } from "./file-storage-deletion-outbox";
import {
  assertExpectedSalesExecutionRevision,
  lockFactoryPurchaseOrders,
  lockSalesExecution,
  salesExecutionAccessWhere,
  type SalesExecutionActor,
} from "./sales-execution-access";
import { executionText } from "./sales-execution-values";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";

type AuditRequest = Parameters<typeof writeAudit>[0];

function requireAdministrator(actor: SalesExecutionActor) {
  const actorId = String(actor?.id || "").trim();
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以永久删除已作废销售执行", 403, "SALES_EXECUTION_DELETE_ADMIN_ONLY");
  }
  return actorId;
}

export async function deleteVoidedSalesExecution(
  request: AuditRequest,
  actor: SalesExecutionActor,
  id: string,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireAdministrator(actor);
  const body = assertJsonObject(input);
  const confirmCustomerOrderNo = executionText(body.confirmCustomerOrderNo, "确认客户订单号", 100, true);
  const reason = executionText(body.reason, "删除原因", 500, true);

  return prisma.$transaction(async (tx) => {
    await lockSalesExecution(tx, id);
    await lockFactoryPurchaseOrders(tx, id);
    const before = await tx.salesExecution.findFirst({
      where: { id, ...salesExecutionAccessWhere(actor) },
      select: {
        id: true,
        customerId: true,
        customerOrderNo: true,
        status: true,
        revision: true,
        sourceType: true,
        sourceQuotationId: true,
        purchaseOrders: {
          select: {
            id: true,
            poNo: true,
            replacementForId: true,
            supplierResponses: { select: { id: true } },
            settlement: { select: { id: true } },
          },
        },
        containerLoads: { select: { id: true } },
        versions: { select: { id: true } },
        items: { select: { id: true } },
        receivableOrder: { select: { id: true, orderNo: true } },
      },
    });
    if (!before) throw codedError("销售执行单不存在或无权访问", 404, "SALES_EXECUTION_NOT_FOUND");
    await assertCustomerScope(actor, before.customerId, tx);
    assertExpectedSalesExecutionRevision(body, before.revision);
    if (before.status !== "VOIDED") {
      throw codedError("只有已作废的销售执行可以永久删除", 409, "SALES_EXECUTION_DELETE_VOIDED_ONLY");
    }
    if (before.receivableOrder) {
      throw codedError("该销售执行已关联应收订单，必须保留业务链路，不能永久删除", 409, "SALES_EXECUTION_DELETE_RECEIVABLE_LINKED");
    }
    if (confirmCustomerOrderNo !== before.customerOrderNo) {
      throw codedError("确认客户订单号不一致，请重新输入", 400, "SALES_EXECUTION_DELETE_CONFIRMATION_MISMATCH");
    }

    const purchaseOrderIds = before.purchaseOrders.map((order) => order.id);
    const responseIds = before.purchaseOrders.flatMap((order) => order.supplierResponses.map((response) => response.id));
    if (before.purchaseOrders.some((order) => order.settlement)) {
      const generatedCostCount = await tx.orderCost.count({
        where: { sourceType: "FACTORY_PURCHASE_SETTLEMENT", sourceId: { in: purchaseOrderIds } },
      });
      if (generatedCostCount) {
        throw codedError("该销售执行已生成应收订单成本，必须保留业务链路，不能永久删除", 409, "SALES_EXECUTION_DELETE_COST_LINKED");
      }
    }

    const fileAssets = await tx.fileAsset.findMany({
      where: {
        OR: [
          { sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS, sourceId: { in: purchaseOrderIds } },
          { sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDER_SUPPLIER_RESPONSES, sourceId: { in: responseIds } },
        ],
      },
      select: { id: true, bucket: true, storageKey: true, sourceTable: true, sourceId: true, fileRole: true },
    });

    await writeAudit(
      request,
      { id: actorId },
      "永久删除已作废销售执行",
      "sales_executions",
      before.id,
      {
        id: before.id,
        customerOrderNo: before.customerOrderNo,
        status: before.status,
        revision: before.revision,
        sourceType: before.sourceType,
        sourceQuotationId: before.sourceQuotationId,
        purchaseOrders: before.purchaseOrders.map((order) => ({ id: order.id, poNo: order.poNo })),
      },
      { deleted: true, reason, documentCount: fileAssets.length },
      tx,
    );

    const deletionTaskIds: string[] = [];
    for (const asset of fileAssets) {
      const task = await enqueueFileStorageDeletion(tx, {
        bucket: asset.bucket,
        storageKey: asset.storageKey,
        sourceTable: asset.sourceTable,
        sourceId: asset.sourceId,
        fileRole: asset.fileRole,
        deleteAfter: new Date(),
      });
      if (task?.id) deletionTaskIds.push(task.id);
    }

    await tx.$queryRaw`SELECT set_config('app.sales_execution_hard_delete_id', ${before.id}, true)`;

    if (purchaseOrderIds.length) {
      const notificationWhere = { relatedEntityType: "factory_purchase_order", relatedEntityId: { in: purchaseOrderIds } };
      const outboxRows = await tx.notificationOutbox.findMany({ where: notificationWhere, select: { id: true } });
      const outboxIds = outboxRows.map((row) => row.id);
      await tx.notificationDeliveryLog.deleteMany({
        where: { OR: [notificationWhere, ...(outboxIds.length ? [{ outboxId: { in: outboxIds } }] : [])] },
      });
      await tx.notificationOutbox.deleteMany({ where: notificationWhere });
    }
    if (fileAssets.length) await tx.fileAsset.deleteMany({ where: { id: { in: fileAssets.map((asset) => asset.id) } } });

    await tx.factoryPurchaseOrderLoadingResultItem.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderLoadingResult.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.containerLoadAllocation.deleteMany({ where: { executionId: before.id } });
    await tx.salesExecutionContainerLoad.deleteMany({ where: { executionId: before.id } });
    await tx.factoryPurchaseOrderProductionReportItem.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderProductionReport.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderDeliveryQuantityVarianceItem.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderDeliveryQuantityVariance.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderSupplierPrice.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderSupplierResponse.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderSettlement.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderAdjustment.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderPayment.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await tx.factoryPurchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });

    const remaining = new Map(before.purchaseOrders.map((order) => [order.id, order]));
    while (remaining.size) {
      const referencedIds = new Set([...remaining.values()].map((order) => order.replacementForId).filter(Boolean));
      const leafIds = [...remaining.keys()].filter((purchaseOrderId) => !referencedIds.has(purchaseOrderId));
      if (!leafIds.length) throw codedError("采购单替换关系异常，已停止删除", 409, "SALES_EXECUTION_DELETE_REPLACEMENT_CYCLE");
      await tx.factoryPurchaseOrder.deleteMany({ where: { id: { in: leafIds }, executionId: before.id } });
      for (const purchaseOrderId of leafIds) remaining.delete(purchaseOrderId);
    }

    await tx.salesExecutionItem.deleteMany({ where: { executionId: before.id } });
    await tx.salesExecutionVersion.deleteMany({ where: { executionId: before.id } });
    const deleted = await tx.salesExecution.deleteMany({
      where: { id: before.id, status: "VOIDED", revision: before.revision },
    });
    if (deleted.count !== 1) {
      throw codedError("销售执行单已被其他用户更新，请刷新后重试", 409, "SALES_EXECUTION_DELETE_CONFLICT");
    }

    return {
      id: before.id,
      customerOrderNo: before.customerOrderNo,
      action: "deleted" as const,
      deletedPurchaseOrderCount: purchaseOrderIds.length,
      deletedDocumentCount: fileAssets.length,
      cleanupPending: deletionTaskIds.length > 0,
    };
  }, { maxWait: 10_000, timeout: 60_000 });
}
