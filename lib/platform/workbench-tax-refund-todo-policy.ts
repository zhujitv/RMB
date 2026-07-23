const EXPORT_INVOICE_DOCUMENT_TYPE = "EXPORT_INVOICE";
const EXPORT_INVOICE_LABEL = "出口发票";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isExactSingleValue(value: unknown, expected: string) {
  return Array.isArray(value)
    && value.length === 1
    && String(value[0] || "").trim() === expected;
}

export function isOnlyExportInvoiceMissing(completeness: unknown) {
  const summary = recordValue(completeness);
  const exportSection = recordValue(summary.export);
  const total = Number(summary.total);
  const completed = Number(summary.completed);
  const exportTotal = Number(exportSection.total);
  const exportCompleted = Number(exportSection.completed);

  return summary.complete === false
    && Number.isFinite(total)
    && total > 0
    && completed === total - 1
    && Number.isFinite(exportTotal)
    && exportTotal > 0
    && exportCompleted === exportTotal - 1
    && isExactSingleValue(summary.missingTypes, EXPORT_INVOICE_DOCUMENT_TYPE)
    && isExactSingleValue(summary.missingLabels, EXPORT_INVOICE_LABEL)
    && isExactSingleValue(exportSection.missingTypes, EXPORT_INVOICE_DOCUMENT_TYPE);
}

export async function forEachTaxRefundTodoPage<T extends { id: string }>(
  loadPage: (cursorId: string | null, pageSize: number) => Promise<T[]>,
  visitPage: (rows: T[]) => Promise<void> | void,
  pageSize: number,
) {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  let cursorId: string | null = null;
  while (true) {
    const rows = await loadPage(cursorId, safePageSize);
    if (!rows.length) return;
    await visitPage(rows);
    if (rows.length < safePageSize) return;
    const nextCursorId = String(rows.at(-1)?.id || "").trim();
    if (!nextCursorId || nextCursorId === cursorId) {
      throw new Error("退税待办分页游标无效，已停止扫描以避免重复处理。");
    }
    cursorId = nextCursorId;
  }
}
