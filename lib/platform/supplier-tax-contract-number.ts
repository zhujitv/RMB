type ContractNumberDraft = {
  contractNo: string;
  customerOrderNo: string;
};

export function supplierTaxContractNumber(orderNo: unknown, fallback = "") {
  return String(orderNo ?? "").trim() || fallback;
}

export function normalizeSupplierTaxContractNumber<T extends ContractNumberDraft>(draft: T): T {
  const contractNo = supplierTaxContractNumber(draft.customerOrderNo, draft.contractNo);
  return contractNo === draft.contractNo ? draft : { ...draft, contractNo };
}

export function supplierTaxContractNumberFromJson(value: unknown, fallback = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return supplierTaxContractNumber((value as { customerOrderNo?: unknown }).customerOrderNo, fallback);
}
