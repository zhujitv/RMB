import {
  cleanCustomsDeclarationProductNameForTaxRefund,
  normalizeCustomsDeclarationItemForTaxRefund,
  type CustomsDeclarationItemFields,
} from "../customs-declaration-parser.ts";
import {
  classifyCustomsHeaderCell,
  collectAliyunTableRows,
  customsHeaderColumns,
  normalizeCurrencyCode,
  parseNumberText,
  responseField,
  stripAliyunStringQuote,
  tableCellTextForColumn,
  type AliyunTableCell,
} from "./aliyun-customs-table-core.ts";

const TABLE_NUMBER_PATTERN = "\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?";
const TABLE_UNIT_PATTERN = "(千克|公斤|克|吨|个|只|件|套|台|米|平方米|立方米|双|条|箱|PCS|PCE|PC|SET|SETS|KG|KGS|M2|M3|MT|UNIT|UNITS|PIECE|PIECES)";
const TABLE_UNIT_REGEX = new RegExp(TABLE_UNIT_PATTERN, "i");
const TABLE_NUMBER_ONLY_REGEX = new RegExp(`^${TABLE_NUMBER_PATTERN}$`);
const CUSTOMS_NON_ITEM_TEXT_PATTERN = /(报关单号|海关编号|预录入编号|申报日期|出口日期|出境关别|进境关别|备案号|境内收发货人|境外收发货人|境内发货人|生产销售单位|消费使用单位|申报单位|运输方式|运输工具名称|航次号|提运单号|提单号|监管方式|征免性质|许可证号|合同协议号|贸易国别|贸易国|运抵国|目的国|指运港|装货港|启运港|成交方式|运费|保费|杂费|件数|包装种类|毛重|净重|集装箱|随附单证|标记唛码|备注|境内货源地|关区|口岸|港区|代理报关|委托协议|统一编号|申报地海关|入境口岸)/;
const CUSTOMS_COMPANY_NAME_PATTERN = /(有限公司|有限责任公司|股份有限公司|进出口公司|贸易公司|B\.?V\.?|LTD\.?|LIMITED|INC\.?|CO\.?,?\s*LTD\.?)/i;
const CUSTOMS_TRANSPORT_OR_PORT_TEXT_PATTERN = /(水路运输|铁路运输|公路运输|航空运输|多式联运|运输工具|航次|提运单|提单|HAMBURG\s+EXPRESS|EXPRESS\s*\/|VESSEL|VOYAGE|MAJOR\s+FENCE\s+B\.?V\.?|洋山\s*区|洋山港区|港区|口岸)/i;
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
    .map(cleanCustomsDeclarationProductNameForTaxRefund)
    .filter(Boolean)
    .filter((part) => !/^(无品牌|无型号|品牌|型号|规格|用途|材质|成分|生产厂家|生产商|境内货源地)/.test(part))
    .filter(isLikelyCustomsProductName);
  return parts[0] || cleanCustomsDeclarationProductNameForTaxRefund(value) || stripAliyunStringQuote(value);
}

function isLikelyCustomsProductName(value = "") {
  const raw = stripAliyunStringQuote(value);
  const text = cleanCustomsDeclarationProductNameForTaxRefund(raw);
  if (!text || !/[\u4e00-\u9fa5A-Za-z]/.test(text)) return false;
  if (classifyCustomsHeaderCell(raw) || classifyCustomsHeaderCell(text)) return false;
  if (CUSTOMS_NON_ITEM_TEXT_PATTERN.test(raw) || CUSTOMS_NON_ITEM_TEXT_PATTERN.test(text)) return false;
  if (CUSTOMS_COMPANY_NAME_PATTERN.test(raw) || CUSTOMS_COMPANY_NAME_PATTERN.test(text)) return false;
  if (CUSTOMS_TRANSPORT_OR_PORT_TEXT_PATTERN.test(raw) || CUSTOMS_TRANSPORT_OR_PORT_TEXT_PATTERN.test(text)) return false;
  if (CUSTOMS_CONTAINER_NO_PATTERN.test(raw) || CUSTOMS_CONTAINER_NO_PATTERN.test(text)) return false;
  if (CUSTOMS_DATE_LIKE_PATTERN.test(raw) || CUSTOMS_DATE_LIKE_PATTERN.test(text)) return false;
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
  if (CUSTOMS_COMPANY_NAME_PATTERN.test(text)) return false;
  if (CUSTOMS_TRANSPORT_OR_PORT_TEXT_PATTERN.test(text)) return false;
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
