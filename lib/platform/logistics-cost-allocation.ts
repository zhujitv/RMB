type LooseRecord = Record<string, unknown>;

function record(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function rows(value: unknown): LooseRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is LooseRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function text(value: unknown) {
  return String(value || "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function generatedLogisticsExpense(cost: unknown) {
  return record(record(cost).generatedLogisticsExpense);
}

function declarationId(declaration: unknown) {
  return text(record(declaration).id);
}

function orderDeclarations(order: unknown) {
  return rows(record(order).customsDeclarations).filter((declaration) => declarationId(declaration));
}

function orderHasMultipleDeclarations(order: unknown) {
  return orderDeclarations(order).length > 1;
}

function sharedAllocationMethod(cost: unknown) {
  const generated = generatedLogisticsExpense(cost);
  if (text(generated.customsDeclarationId)) return "";
  const method = text(generated.allocationMethod);
  return method && method !== "手工金额" ? method : "";
}

function declarationSupplierAmountWeight(declaration: unknown) {
  return rows(record(declaration).suppliers).reduce((sum, supplier) => {
    const amount = numberValue(supplier.requiredInvoiceAmount)
      || numberValue(supplier.vatInvoiceAmount)
      || numberValue(supplier.contractAmount)
      || numberValue(supplier.splitAmount);
    return sum + amount;
  }, 0);
}

function declarationAmountWeight(declaration: unknown) {
  const declarationRecord = record(declaration);
  const amount = numberValue(declarationRecord.declarationAmount)
    || numberValue(declarationRecord.declaration_amount)
    || numberValue(declarationRecord.totalAmount);
  return amount > 0 ? amount : declarationSupplierAmountWeight(declaration);
}

function declarationContainerWeight(declaration: unknown) {
  const declarationRecord = record(declaration);
  const count = numberValue(declarationRecord.containerCount)
    || numberValue(declarationRecord.container_count);
  return count > 0 ? count : 0;
}

function declarationAllocationWeight(declaration: unknown, method: string) {
  if (method === "按报关金额") {
    const amountWeight = declarationAmountWeight(declaration);
    if (amountWeight > 0) return amountWeight;
  }
  if (method === "按供应商开票金额") {
    const amountWeight = declarationSupplierAmountWeight(declaration);
    if (amountWeight > 0) return amountWeight;
  }
  if (method === "按柜数") {
    const containerWeight = declarationContainerWeight(declaration);
    if (containerWeight > 0) return containerWeight;
  }
  return 1;
}

export function logisticsCostMatchesCustomsDeclaration(
  cost: unknown,
  declaration: unknown,
  order: unknown,
) {
  const currentDeclarationId = declarationId(declaration);
  if (!currentDeclarationId) return true;
  const generated = generatedLogisticsExpense(cost);
  const costDeclarationId = text(generated.customsDeclarationId);
  if (costDeclarationId) return costDeclarationId === currentDeclarationId;
  if (sharedAllocationMethod(cost)) return orderHasMultipleDeclarations(order);
  return !orderHasMultipleDeclarations(order);
}

export function allocateLogisticsCostForCustomsDeclaration<T>(
  cost: T,
  declaration: unknown,
  order: unknown,
): T {
  const method = sharedAllocationMethod(cost);
  const currentDeclarationId = declarationId(declaration);
  if (!method || !currentDeclarationId || !orderHasMultipleDeclarations(order)) return cost;
  const declarations = orderDeclarations(order);
  if (!declarations.some((item) => declarationId(item) === currentDeclarationId)) return cost;
  const weights = declarations.map((item) => ({
    id: declarationId(item),
    weight: declarationAllocationWeight(item, method),
  }));
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0) || declarations.length || 1;
  const currentWeight = weights.find((item) => item.id === currentDeclarationId)?.weight || 1;
  const ratio = currentWeight / totalWeight;
  const costRecord = record(cost);
  const allocatedAmount = roundMoney(numberValue(costRecord.amount) * ratio);
  const allocatedAmountCny = roundMoney(numberValue(costRecord.amountCny) * ratio);
  return {
    ...costRecord,
    amount: allocatedAmount,
    amountCny: allocatedAmountCny,
    generatedLogisticsExpense: {
      ...generatedLogisticsExpense(cost),
      allocationMethod: method,
      allocatedAmount,
    },
  } as T;
}
