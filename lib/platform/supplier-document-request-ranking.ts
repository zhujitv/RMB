export const SUPPLIER_DOCUMENT_REQUEST_TERMINAL_STATUSES = ["已完成", "已关闭"] as const;

export function isSupplierDocumentRequestTerminalStatus(status: unknown) {
  return (SUPPLIER_DOCUMENT_REQUEST_TERMINAL_STATUSES as readonly string[]).includes(String(status || "").trim());
}

export type SupplierDocumentRequestPageSegment = {
  skip: number;
  take: number;
};

export type SupplierDocumentRequestRankingPagePlan = {
  actionable: SupplierDocumentRequestPageSegment;
  terminal: SupplierDocumentRequestPageSegment;
};

export function supplierDocumentRequestRankingPagePlan(
  page: number,
  pageSize: number,
  actionableCount: number,
): SupplierDocumentRequestRankingPagePlan {
  const offset = (page - 1) * pageSize;
  const actionableSkip = Math.min(offset, actionableCount);
  const actionableTake = Math.min(pageSize, Math.max(0, actionableCount - actionableSkip));

  return {
    actionable: {
      skip: actionableSkip,
      take: actionableTake,
    },
    terminal: {
      skip: Math.max(0, offset - actionableCount),
      take: pageSize - actionableTake,
    },
  };
}
