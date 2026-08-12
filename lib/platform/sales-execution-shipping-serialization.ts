type LooseRecord = Record<string, unknown>;

function record(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

export function serializeSalesExecutionShipping(value: unknown) {
  const execution = record(value);
  const startedBy = record(execution.shippingStartedBy);
  const order = record(execution.receivableOrder);
  return {
    shippingStartedAt: execution.shippingStartedAt || null,
    shippingStartedBy: startedBy.id ? { id: String(startedBy.id), name: String(startedBy.name || "") } : null,
    receivableOrder: order.id ? {
      id: String(order.id),
      orderNo: String(order.orderNo || ""),
      status: String(order.status || "草稿"),
      deletedAt: order.deletedAt || null,
      createdAt: order.createdAt || null,
    } : null,
  };
}
