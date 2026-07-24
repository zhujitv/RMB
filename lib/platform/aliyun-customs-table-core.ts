export type AliyunTableCell = {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  content: string;
};

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeKey(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s_\-:：,，.。()（）【】\[\]{}《》<>/\\]/g, "");
}

export function normalizeFieldValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) return value.map(normalizeFieldValue).filter(Boolean).join("；");
  if (isPlainRecord(value)) {
    for (const key of ["value", "Value", "text", "Text", "content", "Content", "word", "Word", "name", "Name"]) {
      const text = normalizeFieldValue(value[key]);
      if (text) return text;
    }
  }
  return "";
}

export function parseJsonMaybe(value: unknown) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

export function responseField(record: unknown, key: string) {
  if (!isPlainRecord(record)) return undefined;
  const direct = record[key];
  if (direct != null) return direct;
  const pascal = `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
  if (record[pascal] != null) return record[pascal];
  const upper = key.toUpperCase();
  if (record[upper] != null) return record[upper];
  return undefined;
}

export function parseNumberText(value: unknown) {
  const text = normalizeFieldValue(value)
    .replace(/[,，\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCurrencyCode(value: unknown) {
  const text = normalizeFieldValue(value).toUpperCase();
  if (/美元|USD/.test(text)) return "USD";
  if (/人民币|CNY|RMB/.test(text)) return "CNY";
  if (/欧元|EUR/.test(text)) return "EUR";
  if (/日元|JPY/.test(text)) return "JPY";
  if (/港币|HKD/.test(text)) return "HKD";
  return /^[A-Z]{3}$/.test(text) ? text : "";
}

export function stripAliyunStringQuote(value: unknown) {
  const text = typeof value === "string" ? value : normalizeFieldValue(value);
  return text
    .replace(/^["“”]+|["“”]+$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

export function numericRecordField(record: Record<string, unknown>, key: string, fallback = 0) {
  const value = responseField(record, key);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function tableCellFromRecord(record: Record<string, unknown>): AliyunTableCell | null {
  const content = stripAliyunStringQuote(responseField(record, "cellContent"));
  const rowStart = numericRecordField(record, "rowStart", -1);
  const columnStart = numericRecordField(record, "columnStart", -1);
  if (!content || rowStart < 0 || columnStart < 0) return null;
  return {
    rowStart,
    rowEnd: numericRecordField(record, "rowEnd", rowStart),
    columnStart,
    columnEnd: numericRecordField(record, "columnEnd", columnStart),
    content,
  };
}

export function rowsFromAliyunCells(cells: AliyunTableCell[]) {
  const grouped = new Map<number, AliyunTableCell[]>();
  for (const cell of cells) {
    const row = grouped.get(cell.rowStart) || [];
    row.push(cell);
    grouped.set(cell.rowStart, row);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rowStart, rowCells]) => ({
      rowStart,
      cells: rowCells.sort((left, right) => left.columnStart - right.columnStart || left.columnEnd - right.columnEnd),
    }));
}

export function collectAliyunTableRows(value: unknown, output: Array<{ rowStart: number; cells: AliyunTableCell[] }>[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectAliyunTableRows(parsed, output, depth + 1);
  if (Array.isArray(value)) {
    value.forEach((item) => collectAliyunTableRows(item, output, depth + 1));
    return output;
  }
  if (!isPlainRecord(value)) return output;
  const cellDetails = responseField(value, "cellDetails");
  if (Array.isArray(cellDetails)) {
    const cells = cellDetails
      .map((item) => (isPlainRecord(item) ? tableCellFromRecord(item) : null))
      .filter((item): item is AliyunTableCell => Boolean(item));
    if (cells.length) output.push(rowsFromAliyunCells(cells));
    return output;
  }
  Object.values(value).forEach((item) => collectAliyunTableRows(item, output, depth + 1));
  return output;
}

export function classifyCustomsHeaderCell(value = "") {
  const normalized = normalizeKey(value);
  if (!normalized) return "";
  if (/商品名称|商品名称及规格型号|中文品名|品名|规格型号|DESCRIPTION|PRODUCT/.test(normalized)) return "productName";
  if (/数量及单位|数量单位|QUANTITYUNIT/.test(normalized)) return "quantityUnit";
  if (/成交数量|法定数量|第一数量|数量|QUANTITY/.test(normalized)) return "quantity";
  if (/成交单位|法定单位|第一单位|单位|UNIT/.test(normalized)) return "unit";
  if (/总价|总金额|成交金额|FOB金额|金额|AMOUNT|TOTAL/.test(normalized)) return "totalAmount";
  if (/币制|币种|成交币制|CURRENCY/.test(normalized)) return "currency";
  return "";
}

export function customsHeaderColumns(rows: Array<{ rowStart: number; cells: AliyunTableCell[] }>) {
  const columns: Record<string, { start: number; end: number }> = {};
  const headerRows = rows.slice(0, 20).filter((row) => (
    row.cells.filter((cell) => classifyCustomsHeaderCell(cell.content)).length >= 2
  ));
  for (const row of headerRows) {
    for (const cell of row.cells) {
      const kind = classifyCustomsHeaderCell(cell.content);
      if (kind && !columns[kind]) columns[kind] = { start: cell.columnStart, end: cell.columnEnd };
    }
  }
  return { columns, headerRowStarts: new Set(headerRows.map((row) => row.rowStart)) };
}

export function tableCellTextForColumn(row: { cells: AliyunTableCell[] }, column?: { start: number; end: number }) {
  if (!column) return "";
  return row.cells
    .filter((cell) => cell.columnStart <= column.end && cell.columnEnd >= column.start)
    .map((cell) => cell.content)
    .filter(Boolean)
    .join(" ");
}
