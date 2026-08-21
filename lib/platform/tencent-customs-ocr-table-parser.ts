export type TencentCustomsExperimentTable = {
  page: number;
  tableIndex: number;
  type: number | null;
  rows: string[][];
  cells: Array<{
    row: number;
    column: number;
    rowEnd: number;
    columnEnd: number;
    text: string;
    confidence: number | null;
  }>;
};

const CUSTOMS_TABLE_NUMBER_PATTERN = "-?\\d[\\d,，]*(?:\\.\\d+)?";
const CUSTOMS_TABLE_UNIT_PATTERN = "(千克|公斤|克|吨|个|只|件|套|台|米|平方米|立方米|双|条|箱|片|PCS|PCE|PC|SET|SETS|KG|KGS|M2|M3|MT|UNIT|UNITS|PIECE|PIECES)";
const CUSTOMS_TABLE_UNIT_REGEX = new RegExp(CUSTOMS_TABLE_UNIT_PATTERN, "i");

function headerColumn(row: string[], aliases: RegExp) {
  return row.findIndex((value) => aliases.test(String(value || "").replace(/\s+/g, "")));
}

function nonEmpty(value: unknown) {
  return String(value || "").trim();
}

function hsCodeLikeNumber(value = "") {
  return /^\d{8,13}$/.test(value.replace(/[,\s，]/g, ""));
}

function normalizedNumber(value = "") {
  return String(value || "").replace(/[,，\s]/g, "");
}

function validQuantity(value = "") {
  const text = normalizedNumber(value);
  return /^-?\d+(?:\.\d+)?$/.test(text) && !hsCodeLikeNumber(text) && Number(text) > 0 ? text : "";
}

function unitFromText(value = "") {
  return nonEmpty(value).match(CUSTOMS_TABLE_UNIT_REGEX)?.[1] || "";
}

function quantityUnitCandidates(value: string) {
  const text = nonEmpty(value);
  const amountThenUnit = new RegExp(`(${CUSTOMS_TABLE_NUMBER_PATTERN})\\s*${CUSTOMS_TABLE_UNIT_PATTERN}`, "ig");
  const unitThenAmount = new RegExp(`${CUSTOMS_TABLE_UNIT_PATTERN}\\s*(${CUSTOMS_TABLE_NUMBER_PATTERN})`, "ig");
  return [
    ...[...text.matchAll(amountThenUnit)].map((match) => ({ quantity: validQuantity(match[1]), unit: match[2] || "" })),
    ...[...text.matchAll(unitThenAmount)]
      .filter((match) => !/\d[\d,，]*(?:\.\d+)?\s*$/.test(text.slice(0, match.index || 0)))
      .map((match) => ({ quantity: validQuantity(match[2]), unit: match[1] || "" })),
  ]
    .filter((entry) => entry.quantity && entry.unit)
    .filter((entry, index, rows) => rows.findIndex((row) => row.quantity === entry.quantity && row.unit === entry.unit) === index)
    .slice(0, 3)
    .map((entry) => ({ quantity: entry.quantity, unit: entry.unit }));
}

function quantityUnitFromSplitColumns(quantityValue = "", unitValue = "") {
  const quantity = validQuantity(quantityValue);
  const unit = unitFromText(unitValue);
  return quantity && unit ? [{ quantity, unit }] : [];
}

function quantityUnitsFromRow(row: string[], quantityColumn: number, unitColumn: number) {
  const preferred = quantityColumn >= 0 ? quantityUnitCandidates(row[quantityColumn] || "") : [];
  if (preferred.length) return preferred;
  const split = quantityColumn >= 0 && unitColumn >= 0
    ? quantityUnitFromSplitColumns(row[quantityColumn] || "", row[unitColumn] || "")
    : [];
  if (split.length) return split;
  for (let index = 0; index < row.length; index += 1) {
    const fromCell = quantityUnitCandidates(row[index] || "");
    if (fromCell.length) return fromCell;
    const unit = unitFromText(row[index] || "");
    if (!unit) continue;
    const previous = quantityUnitFromSplitColumns(row[index - 1] || "", row[index] || "");
    if (previous.length) return previous;
    const next = quantityUnitFromSplitColumns(row[index + 1] || "", row[index] || "");
    if (next.length) return next;
  }
  return [];
}

export function customsProductName(value: string) {
  const firstLine = String(value || "").split(/[\r\n]+/).map((line) => line.trim()).find(Boolean) || "";
  const declarationElementsAt = firstLine.search(/(?:申报要素\s*[:：]?|\s*\d{1,2}\|[^|]{0,80}\|)/);
  const withoutDeclarationElements = (declarationElementsAt > 0 ? firstLine.slice(0, declarationElementsAt) : firstLine)
    .replace(new RegExp(`\\s+${CUSTOMS_TABLE_NUMBER_PATTERN}\\s*${CUSTOMS_TABLE_UNIT_PATTERN}.*$`, "i"), "")
    .replace(new RegExp(`\\s+${CUSTOMS_TABLE_UNIT_PATTERN}\\s*${CUSTOMS_TABLE_NUMBER_PATTERN}.*$`, "i"), "")
    .trim();
  return withoutDeclarationElements
    .replace(/^\s*\d{1,3}\s+[0-9]{8,13}\s+/, "")
    .replace(/^\s*[0-9]{8,13}\s+/, "")
    .replace(/\s+[0-9]{8,13}\s*$/, "")
    .trim();
}

function rowText(row: string[]) {
  return row.map(nonEmpty).filter(Boolean).join(" ");
}

function cellLines(value: string) {
  return String(value || "").split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
}

function splitCollapsedCustomsRows(row: string[]) {
  const text = rowText(row);
  const matches = [...text.matchAll(/(?:^|\s)(\d{1,3})\s+\d{8,13}\b/g)];
  if (matches.length <= 1) return [row];
  return matches.map((match, index) => {
    const rawStart = match.index || 0;
    const start = /\s/.test(text[rawStart] || "") ? rawStart + 1 : rawStart;
    const next = matches[index + 1];
    const rawEnd = next?.index ?? text.length;
    return [text.slice(start, rawEnd).trim()];
  }).filter((entry) => entry[0]);
}

function expandedCustomsRows(row: string[], columns: number[]) {
  const collapsed = splitCollapsedCustomsRows(row);
  if (collapsed.length > 1) return collapsed;
  const inspected = columns.filter((column) => column >= 0).map((column) => cellLines(row[column] || ""));
  const maxLines = Math.max(1, ...inspected.map((lines) => lines.length));
  const hasItemBreaks = columns.slice(0, 2).some((column) => column >= 0 && cellLines(row[column] || "").length === maxLines && maxLines > 1);
  const hasNameQuantityBreaks = columns[2] >= 0 && columns[3] >= 0
    && cellLines(row[columns[2]] || "").length === maxLines
    && cellLines(row[columns[3]] || "").length === maxLines
    && maxLines > 1;
  if (!hasItemBreaks && !hasNameQuantityBreaks) return [row];
  return Array.from({ length: maxLines }, (_, lineIndex) => row.map((cell) => {
    const lines = cellLines(cell || "");
    return lines.length === maxLines ? lines[lineIndex] || "" : cell;
  }));
}

function commodityCodeFromRow(row: string[], codeColumn: number) {
  const preferred = codeColumn >= 0 ? nonEmpty(row[codeColumn]).match(/\b\d{8,13}\b/)?.[0] || "" : "";
  return preferred || rowText(row).match(/\b\d{8,13}\b/)?.[0] || "";
}

function itemNoFromRow(row: string[], itemNoColumn: number) {
  const preferred = itemNoColumn >= 0 ? nonEmpty(row[itemNoColumn]) : "";
  if (/^\d{1,3}$/.test(preferred)) return preferred;
  return rowText(row).match(/^\s*(\d{1,3})\s+\d{8,13}\b/)?.[1] || "";
}

function productNameFromRow(row: string[], nameColumn: number) {
  const preferred = nameColumn >= 0 ? customsProductName(row[nameColumn] || "") : "";
  if (preferred && /[\u4e00-\u9fa5A-Za-z]/.test(preferred)) return preferred;
  return row
    .map((cell) => customsProductName(cell || ""))
    .find((cell) => /[\u4e00-\u9fa5A-Za-z]/.test(cell) && !CUSTOMS_TABLE_UNIT_REGEX.test(cell) && !/^\d{8,13}$/.test(cell))
    || customsProductName(rowText(row));
}

export function candidateItemsFromTencentTables(tables: TencentCustomsExperimentTable[]) {
  return tables.flatMap((table) => {
    const headerIndex = table.rows.findIndex((row) => {
      const text = row.join("").replace(/\s+/g, "");
      return /商品|品名/.test(text) && /数量|单位/.test(text) && /项号|商品编号|商品编码/.test(text);
    });
    if (headerIndex < 0) return [];
    const header = table.rows[headerIndex];
    const itemNoColumn = headerColumn(header, /项号/);
    const codeColumn = headerColumn(header, /商品(?:编号|编码)|税则号列/);
    const nameColumn = headerColumn(header, /商品名称|品名|名称及规格/);
    const quantityColumn = headerColumn(header, /数量及单位|成交数量|第一数量|第二数量|数量/);
    const unitColumn = headerColumn(header, /成交单位|计量单位|单位/);
    const amountColumn = headerColumn(header, /单价.*总价|总价.*币制|金额/);
    return table.rows.slice(headerIndex + 1).flatMap((sourceRow, offset) => expandedCustomsRows(sourceRow, [
      itemNoColumn,
      codeColumn,
      nameColumn,
      quantityColumn,
      unitColumn,
      amountColumn,
    ]).flatMap((row) => {
      const nameAndSpecification = nameColumn >= 0 ? nonEmpty(row[nameColumn]) : rowText(row);
      const quantityAndUnit = quantityColumn >= 0 ? nonEmpty(row[quantityColumn]) : "";
      const quantityUnits = quantityUnitsFromRow(row, quantityColumn, unitColumn);
      const commodityCode = commodityCodeFromRow(row, codeColumn);
      const productName = productNameFromRow(row, nameColumn);
      if (!nameAndSpecification && !quantityAndUnit && !commodityCode) return [];
      return [{
        page: table.page,
        tableIndex: table.tableIndex,
        row: headerIndex + offset + 1,
        itemNo: itemNoFromRow(row, itemNoColumn),
        commodityCode,
        nameAndSpecification,
        productName,
        quantityAndUnit,
        quantityUnits,
        priceAmountCurrency: amountColumn >= 0 ? String(row[amountColumn] || "").trim() : "",
      }];
    }));
  });
}

export function candidateItemsFromCustomsText(text = "") {
  const body = nonEmpty(text).replace(/\n+/g, " ");
  if (!body) return [];
  return candidateItemsFromTencentTables([{
    page: 1,
    tableIndex: 999,
    type: null,
    rows: [
      ["项号 商品编号 商品名称及规格型号 数量及单位 总价 币制"],
      [body],
    ],
    cells: [],
  }]);
}
