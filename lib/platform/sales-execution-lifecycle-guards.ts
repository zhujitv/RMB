import { codedError } from "./shared";

type SalesExecutionShippingAnchor = {
  receivableOrder?: unknown;
  shippingStartedAt?: unknown;
};

export function assertSalesExecutionCanBeVoided(execution: SalesExecutionShippingAnchor) {
  if (!execution.receivableOrder && !execution.shippingStartedAt) return;
  throw codedError(
    "该销售执行单已进入发货并关联应收订单，不能直接作废；请在应收订单中保留审计记录并改为已取消。",
    409,
    "SALES_EXECUTION_SHIPPING_STARTED",
  );
}
