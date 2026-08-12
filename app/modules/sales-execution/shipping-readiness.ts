import { numeric, type SalesExecutionRow } from "./types";

export type ShippingReadiness = {
  ready: boolean;
  reason: string;
};

export function salesExecutionShippingReadiness(execution?: SalesExecutionRow | null): ShippingReadiness {
  if (!execution) return { ready: false, reason: "请先打开销售执行单" };
  if (execution.receivableOrder || execution.shippingStartedAt) {
    return { ready: false, reason: "该销售执行单已经进入发货" };
  }
  if (execution.status !== "DISPATCHED") {
    return { ready: false, reason: "只有已正式下发的销售执行单可以进入发货" };
  }
  const orders = (execution.purchaseOrders || []).filter((order) => order.status !== "VOIDED");
  if (!orders.length) return { ready: false, reason: "尚未生成工厂采购单" };
  const allocatedByItem = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items || []) {
      const executionItemId = String(item.executionItemId || item.salesExecutionItemId || "");
      allocatedByItem.set(executionItemId, (allocatedByItem.get(executionItemId) || 0) + numeric(item.allocatedQuantity ?? item.quantity));
    }
  }
  const allocationIncomplete = (execution.items || []).some((item) => (
    Math.abs((allocatedByItem.get(item.id) || 0) - numeric(item.quantity)) > 0.000001
  ));
  if (allocationIncomplete) return { ready: false, reason: "被拒采购单尚未重新选厂并完整覆盖销售数量" };
  const unaccepted = orders.filter((order) => order.status !== "ACCEPTED");
  if (unaccepted.length) {
    return { ready: false, reason: `还有 ${unaccepted.length} 张采购单待确认或等待新交期内部确认` };
  }
  const unfinished = orders.filter((order) => order.productionStatus !== "COMPLETED");
  if (unfinished.length) return { ready: false, reason: `还有 ${unfinished.length} 张采购单未完成生产` };
  const undelivered = orders.filter((order) => !order.actualDeliveryDate);
  if (undelivered.length) return { ready: false, reason: `还有 ${undelivered.length} 张采购单未登记实际交付日期` };
  return { ready: true, reason: "所有有效采购单均已确认、完工并登记实际交付" };
}
