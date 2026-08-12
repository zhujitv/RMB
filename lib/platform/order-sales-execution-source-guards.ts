import { codedError } from "./shared";

type LinkedOrderIdentity = {
  sourceSalesExecutionId?: string | null;
  orderNo?: string | null;
  customerId?: string | null;
  businessEntityId?: string | null;
  salespersonUserId?: string | null;
  currency?: string | null;
};

function normalized(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function assertLinkedOrderIdentityUnchanged(
  current: LinkedOrderIdentity | null | undefined,
  next: Omit<LinkedOrderIdentity, "sourceSalesExecutionId">,
) {
  if (!current?.sourceSalesExecutionId) return;
  const changed = normalized(current.orderNo) !== normalized(next.orderNo)
    || String(current.customerId || "") !== String(next.customerId || "")
    || String(current.businessEntityId || "") !== String(next.businessEntityId || "")
    || String(current.salespersonUserId || "") !== String(next.salespersonUserId || "")
    || normalized(current.currency) !== normalized(next.currency);
  if (!changed) return;
  throw codedError(
    "该订单由销售执行单生成，订单号、客户、业务主体、业务员和币种必须与来源保持一致。",
    409,
    "ORDER_SALES_EXECUTION_IDENTITY_LOCKED",
  );
}
