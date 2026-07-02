import {
  normalizeCustomsDeclarationItemForTaxRefund,
  type CustomsDeclarationItemFields,
} from "../customs-declaration-parser.ts";

type AliyunTableCell = {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  content: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s_\-:：,，.。()（）【】\[\]{}《》<>/\\]/g, "");
}

function normalizeFieldValue(value: unknown) {
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

function parseJsonMaybe(value: unknown) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function responseField(record: unknown, key: string) {
  if (!isPlainRecord(record)) return undefined;
  const direct = record[key];
  if (direct != null) return direct;
  const pascal = `${key.slice(0, 1).toUpperCase()}${key.slice(1)}`;
  if (record[pascal] != null) return record[pascal];
  const upper = key.toUpperCase();
  if (record[upper] != null) return record[upper];
  return undefined;
}

function parseNumberText(value: unknown) {
  const text = normalizeFieldValue(value)
    .replace(/[,，\s]/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrencyCode(value: unknown) {
  const text = normalizeFieldValue(value).toUpperCase();
  if (/美元|USD/.test(text)) return "USD";
  if (/人民币|CNY|RMB/.test(text)) return "CNY";
  if (/欧元|EUR/.test(text)) return "EUR";
  if (/日元|JPY/.test(text)) return "JPY";
  if (/港币|HKD/.test(text)) return "HKD";
  return /^[A-Z]{3}$/.test(text) ? text : "";
}

function stripAliyunStringQuote(value: unknown) {
  const text = typeof value === "string" ? value : normalizeFieldValue(value);
  return text
    .replace(/^["“”]+|["“”]+$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

function numericRecordField(record: Record<string, unknown>, key: string, fallback = 0) {
  const value = responseField(record, key);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function tableCellFromRecord(record: Record<string, unknown>): AliyunTableCell | null {
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

function rowsFromAliyunCells(cells: AliyunTableCell[]) {
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

function collectAliyunTableRows(value: unknown, output: Array<{ rowStart: number; cells: AliyunTableCell[] }>[] = [], depth = 0) {
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

function classifyCustomsHeaderCell(value = "") {
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

function customsHeaderColumns(rows: Array<{ rowStart: number; cells: AliyunTableCell[] }>) {
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

function tableCellTextForColumn(row: { cells: AliyunTableCell[] }, column?: { start: number; end: number }) {
  if (!column) return "";
  return row.cells
    .filter((cell) => cell.columnStart <= column.end && cell.columnEnd >= column.start)
    .map((cell) => cell.content)
    .filter(Boolean)
    .join(" ");
}

const TABLE_NUMBER_PATTERN = "\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?";
const TABLE_UNIT_PATTERN = "(千克|公斤|克|吨|个|只|件|套|台|米|平方米|立方米|双|条|箱|PCS|PCE|PC|SET|SETS|KG|KGS|M2|M3|MT|UNIT|UNITS|PIECE|PIECES)";
const TABLE_UNIT_REGEX = new RegExp(TABLE_UNIT_PATTERN, "i");
const TABLE_NUMBER_ONLY_REGEX = new RegExp(`^${TABLE_NUMBER_PATTERN}$`);
const CUSTOMS_NON_ITEM_TEXT_PATTERN = /(报关单号|海关编号|预录入编号|申报日期|出口日期|出境关别|进境关别|备案号|境内收发货人|境外收发货人|境内发货人|生产销售单位|消费使用单位|申报单位|运输方式|运输工具名称|航次号|提运单号|提单号|监管方式|征免性质|许可证号|合同协议号|贸易国别|贸易国|运抵国|目的国|指运港|装货港|启运港|成交方式|运费|保费|杂费|件数|包装种类|毛重|净重|集装箱|随附单证|标记唛码|备注|境内货源地|关区|口岸|港区|代理报关|委托协议|统一编号|申报地海关|入境口岸)/;
const CUSTOMS_COMPANY_NAME_PATTERN = /(有限公司|有限责任公司|股份有限公司|进出口公司|贸易公司|B\.?V\.?|LTD\.?|LIMITED|INC\.?|CO\.?,?\s*LTD\.?)$/i;
const CUSTOMS_CONTAINER_NO_PATTERN = /\b[A-Z]{4}\d{7}\b/i;
const CUSTOMS_DATE_LIKE_PATTERN = /\b20\d{2}[年/.-]?\d{1,2}[月/.-]?\d{1,2}(?:日)?\b/;

function parseQuantityUnitText(value = "") {
  const text = stripAliyunStringQuote(value);
  let match = text.match(new RegExp(`(${TABLE_NUMBER_PATTERN})\\s*${TABLE_UNIT_PATTERN}`, "i"));
  if (match) return { quantity: parseNumberText(match[1]), unit: match[2] || "" };
  match = text.match(new RegExp(`${TABLE_UNIT_PATTERN}\\s*(${TABLE_NUMBER_PATTERN})`, "i"));
  if (match) return { quantity: parseNumberText(match[2]), unit: match[1] || "" };
  return { quantity: parseNumberText(text), unit: "" };
}

function normalizeTableUnit(value = "") {
  const text = stripAliyunStringQuote(value);
  const match = text.match(TABLE_UNIT_REGEX);
  return match?.[1] || "";
}

function numericCellValue(value = "") {
  const text = stripAliyunStringQuote(value).replace(/[,，\s]/g, "");
  return TABLE_NUMBER_ONLY_REGEX.test(text) ? parseNumberText(text) : 0;
}

function parseTableAmountText(value = "") {
  const text = stripAliyunStringQuote(value);
  if (CUSTOMS_DATE_LIKE_PATTERN.test(text)) return 0;
  return parseNumberText(text);
}

function quantityUnitFromRowHeuristic(row: { cells: AliyunTableCell[] }) {
  for (const cell of row.cells) {
    const parsed = parseQuantityUnitText(cell.content);
    if (parsed.quantity > 0 && parsed.unit) return parsed;
  }
  for (let index = 0; index < row.cells.length; index += 1) {
    const unit = normalizeTableUnit(row.cells[index]?.content || "");
    if (!unit) continue;
    const previousQuantity = numericCellValue(row.cells[index - 1]?.content || "");
    if (previousQuantity > 0) return { quantity: previousQuantity, unit };
    const nextQuantity = numericCellValue(row.cells[index + 1]?.content || "");
    if (nextQuantity > 0) return { quantity: nextQuantity, unit };
  }
  return { quantity: 0, unit: "" };
}

function productNameFromTableCell(value = "") {
  const parts = String(value || "")
    .replace(/\\n/g, "\n")
    .split(/\n|[;；]/)
    .map(stripAliyunStringQuote)
    .map((part) => part.replace(/^\s*\d{1,3}\s+/, "").replace(/^\s*\d{8,13}\s+/, "").trim())
    .filter(Boolean)
    .filter((part) => !/^(无品牌|无型号|品牌|型号|规格|用途|材质|成分|生产厂家|生产商|境内货源地)/.test(part))
    .filter(isLikelyCustomsProductName);
  return parts[0] || stripAliyunStringQuote(value);
}

function isLikelyCustomsProductName(value = "") {
  const text = stripAliyunStringQuote(value);
  if (!text || !/[\u4e00-\u9fa5A-Za-z]/.test(text)) return false;
  if (classifyCustomsHeaderCell(text)) return false;
  if (CUSTOMS_NON_ITEM_TEXT_PATTERN.test(text)) return false;
  if (CUSTOMS_COMPANY_NAME_PATTERN.test(text)) return false;
  if (CUSTOMS_CONTAINER_NO_PATTERN.test(text)) return false;
  if (CUSTOMS_DATE_LIKE_PATTERN.test(text)) return false;
  if (/^\d{1,3}$/.test(text)) return false;
  if (/^\d{8,13}$/.test(text)) return false;
  if (/^(USD|CNY|RMB|EUR|JPY|HKD|美元|人民币|欧元|日元|港币)$/i.test(text)) return false;
  if (/^\d+(?:[,，]\d{3})*(?:\.\d+)?$/.test(text)) return false;
  if (parseQuantityUnitText(text).unit) return false;
  return true;
}

function productNameFromRowHeuristic(row: { cells: AliyunTableCell[] }) {
  const candidates = row.cells
    .map((cell) => productNameFromTableCell(cell.content))
    .filter(isLikelyCustomsProductName);
  return candidates[0] || "";
}

function totalAmountFromRowHeuristic(row: { cells: AliyunTableCell[] }, quantity = 0) {
  const candidates = row.cells
    .flatMap((cell) => (
      CUSTOMS_DATE_LIKE_PATTERN.test(cell.content)
        ? []
        : [...cell.content.matchAll(/\d+(?:[,，]\d{3})*(?:\.\d+)?/g)].map((match) => parseNumberText(match[0]))
    ))
    .filter((value) => value > 0 && Math.abs(value - quantity) > 0.0001);
  return candidates.length ? candidates[candidates.length - 1] : 0;
}

function rowLooksLikeCustomsItem(row: { cells: AliyunTableCell[] }) {
  const text = row.cells.map((cell) => cell.content).join(" ");
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(text)) return false;
  if (!/\d+(?:[,，]\d{3})*(?:\.\d+)?/.test(text)) return false;
  if (CUSTOMS_NON_ITEM_TEXT_PATTERN.test(text)) return false;
  return row.cells.some((cell) => isLikelyCustomsProductName(cell.content));
}

function dedupeCustomsItems(items: CustomsDeclarationItemFields[] = []) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.productName,
      item.quantity || 0,
      item.unit || "",
      item.currency || "",
      item.totalAmount || item.fobAmount || 0,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractCustomsItemsFromAliyunTableData(
  value: unknown,
  defaults: Partial<Pick<CustomsDeclarationItemFields, "currency" | "tradeTerm">> = {},
) {
  const tables = collectAliyunTableRows(value);
  const items: CustomsDeclarationItemFields[] = [];
  for (const rows of tables) {
    const { columns, headerRowStarts } = customsHeaderColumns(rows);
    const hasStructuredItemColumns = Boolean(
      columns.productName
      && columns.totalAmount
      && (columns.quantityUnit || columns.quantity || columns.unit),
    );
    for (const row of rows) {
      if (headerRowStarts.has(row.rowStart)) continue;
      const productName = productNameFromTableCell(tableCellTextForColumn(row, columns.productName)) || productNameFromRowHeuristic(row);
      if (!isLikelyCustomsProductName(productName)) continue;
      if (!hasStructuredItemColumns && !rowLooksLikeCustomsItem(row)) continue;
      const quantityUnitText = tableCellTextForColumn(row, columns.quantityUnit);
      const quantityUnit = parseQuantityUnitText(quantityUnitText);
      const heuristicQuantityUnit = quantityUnit.quantity && quantityUnit.unit
        ? quantityUnit
        : quantityUnitFromRowHeuristic(row);
      const quantity = quantityUnit.quantity
        || parseNumberText(tableCellTextForColumn(row, columns.quantity))
        || heuristicQuantityUnit.quantity;
      const unit = quantityUnit.unit
        || tableCellTextForColumn(row, columns.unit)
        || heuristicQuantityUnit.unit;
      const totalAmount = parseTableAmountText(tableCellTextForColumn(row, columns.totalAmount)) || totalAmountFromRowHeuristic(row, quantity);
      const currency = normalizeCurrencyCode(tableCellTextForColumn(row, columns.currency))
        || normalizeCurrencyCode(row.cells.map((cell) => cell.content).join(" "))
        || defaults.currency
        || "";
      const item = normalizeCustomsDeclarationItemForTaxRefund({
        productName,
        quantity,
        unit,
        totalAmount,
        currency,
        tradeTerm: defaults.tradeTerm || "",
      }, defaults);
      if (item) items.push(item);
    }
  }
  return dedupeCustomsItems(items);
}

export function hasAliyunTableShape(value: Record<string, unknown>) {
  return Boolean(
    responseField(value, "cellContent")
    || responseField(value, "cellDetails")
    || responseField(value, "tableDetails")
    || responseField(value, "tableInfo")
    || responseField(value, "blockInfo")
    || responseField(value, "subImages"),
  );
}
