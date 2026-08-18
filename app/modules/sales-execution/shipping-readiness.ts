import type { SalesExecutionRow } from "./types";
import { productionQuantityUnits } from "../production-progress-quantity";

export type ShippingReadiness = {
  ready: boolean;
  reason: string;
};

export function salesExecutionShippingReadiness(execution?: SalesExecutionRow | null): ShippingReadiness {
  if (!execution) return { ready: false, reason: "请先打开销售执行单" };
  if (execution.shippingStartedAt) {
    return { ready: false, reason: "该销售执行单已确认装柜完成" };
  }
  if (execution.status !== "DISPATCHED") {
    return { ready: false, reason: "只有已正式下发的销售执行单可以进入发货" };
  }
  const orders = (execution.purchaseOrders || []).filter((order) => order.status !== "VOIDED" && order.status !== "REJECTED");
  if (!orders.length) return { ready: false, reason: "尚未生成工厂采购单" };
  const allocatedByItem = new Map<string, bigint>();
  let allocationInvalid = false;
  for (const order of orders) {
    for (const item of order.items || []) {
      const executionItemId = String(item.executionItemId || item.salesExecutionItemId || "");
      const quantity = productionQuantityUnits(item.allocatedQuantity ?? item.quantity);
      if (!executionItemId || quantity === null) { allocationInvalid = true; continue; }
      allocatedByItem.set(executionItemId, (allocatedByItem.get(executionItemId) || BigInt(0)) + quantity);
    }
  }
  const allocationIncomplete = allocationInvalid || (execution.items || []).some((item) => {
    const quantity = productionQuantityUnits(item.quantity);
    return quantity === null || (allocatedByItem.get(item.id) || BigInt(0)) !== quantity;
  });
  if (allocationIncomplete) return { ready: false, reason: "被拒采购单尚未重新选厂并完整覆盖销售数量" };
  const unaccepted = orders.filter((order) => order.status !== "ACCEPTED");
  if (unaccepted.length) {
    return { ready: false, reason: `还有 ${unaccepted.length} 张采购单待确认或等待新交期内部确认` };
  }
  const unfinished = orders.filter((order) => order.productionStatus !== "COMPLETED");
  if (unfinished.length) return { ready: false, reason: `还有 ${unfinished.length} 张采购单未完成生产` };
  if (!execution.receivableOrder) {
    return { ready: true, reason: "采购单均已确认并完成生产，可以先创建应收订单；柜号可在提柜后补充" };
  }
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const containerLoads = (execution.containerLoads || []).filter((load) => (
    load.status !== "VOIDED" && load.allocations.some((allocation) => orderById.has(allocation.purchaseOrderId))
  ));
  if (!containerLoads.length) return { ready: false, reason: "尚未创建集装箱柜总单" };
  const mixedInvalidLoad = containerLoads.some((load) => (
    load.allocations.some((allocation) => !orderById.has(allocation.purchaseOrderId))
  ));
  if (mixedInvalidLoad) {
    return { ready: false, reason: "有集装箱同时包含有效及已拒绝、已作废或不存在的采购单，请先修正或作废该柜" };
  }
  const loadingPending = containerLoads.flatMap((load) => load.loadingResults)
    .filter((result) => result.status === "PENDING" && orderById.has(result.purchaseOrderId));
  if (loadingPending.length) return { ready: false, reason: `还有 ${loadingPending.length} 条本柜实装差异待审批` };
  const unreleased = containerLoads.filter((load) => load.status !== "RELEASED");
  if (unreleased.length) return { ready: false, reason: `还有 ${unreleased.length} 个集装箱未最终放行` };
  const deliveredByItem = new Map<string, bigint>();
  let resultLineInvalid = false;
  for (const load of containerLoads) {
    for (const result of load.loadingResults.filter((entry) => entry.status === "APPROVED")) {
      const order = orderById.get(result.purchaseOrderId);
      if (!order) continue;
      for (const resultItem of result.items) {
        const purchaseItem = order.items?.find((item) => item.id === resultItem.purchaseOrderItemId);
        const executionItemId = String(purchaseItem?.executionItemId || purchaseItem?.salesExecutionItemId || "");
        const loadedUnits = productionQuantityUnits(resultItem.loadedQuantity);
        if (!executionItemId || loadedUnits === null) { resultLineInvalid = true; continue; }
        deliveredByItem.set(executionItemId, (deliveredByItem.get(executionItemId) || BigInt(0)) + loadedUnits);
      }
    }
  }
  if (resultLineInvalid) return { ready: false, reason: "部分柜内实装结果缺少对应采购明细" };
  const actualQuantityShort = (execution.items || []).some((item) => {
    const salesUnits = productionQuantityUnits(item.quantity);
    return salesUnits === null || (deliveredByItem.get(item.id) || BigInt(0)) < salesUnits;
  });
  if (actualQuantityShort) return { ready: false, reason: "整单实装数量不足，需由其它工厂补足后才能进入发货" };
  return { ready: true, reason: "所有集装箱已放行，最终实装数量覆盖销售数量，可以确认装柜完成" };
}
