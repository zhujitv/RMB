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

function headerColumn(row: string[], aliases: RegExp) {
  return row.findIndex((value) => aliases.test(String(value || "").replace(/\s+/g, "")));
}

function quantityUnitCandidates(value: string) {
  return [...String(value || "").matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*([^\d\s,，/]{1,12})/g)]
    .slice(0, 3)
    .map((match) => ({ quantity: match[1].replace(/,/g, ""), unit: match[2] }));
}

export function customsProductName(value: string) {
  const firstLine = String(value || "").split(/[\r\n]+/).map((line) => line.trim()).find(Boolean) || "";
  const declarationElementsAt = firstLine.search(/(?:申报要素\s*[:：]?|\s*\d{1,2}\|[^|]{0,80}\|)/);
  const withoutDeclarationElements = (declarationElementsAt > 0 ? firstLine.slice(0, declarationElementsAt) : firstLine).trim();
  return withoutDeclarationElements
    .replace(/^\s*\d{1,3}\s+[0-9]{8,10}\s+/, "")
    .replace(/^\s*[0-9]{8,10}\s+/, "")
    .trim();
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
    const quantityColumn = headerColumn(header, /数量及单位|数量|计量单位/);
    const amountColumn = headerColumn(header, /单价.*总价|总价.*币制|金额/);
    return table.rows.slice(headerIndex + 1).flatMap((row, offset) => {
      const nameAndSpecification = nameColumn >= 0 ? String(row[nameColumn] || "").trim() : "";
      const quantityAndUnit = quantityColumn >= 0 ? String(row[quantityColumn] || "").trim() : "";
      const commodityCode = codeColumn >= 0 ? String(row[codeColumn] || "").trim() : "";
      if (!nameAndSpecification && !quantityAndUnit && !commodityCode) return [];
      return [{
        page: table.page,
        tableIndex: table.tableIndex,
        row: headerIndex + offset + 1,
        itemNo: itemNoColumn >= 0 ? String(row[itemNoColumn] || "").trim() : "",
        commodityCode,
        nameAndSpecification,
        productName: customsProductName(nameAndSpecification),
        quantityAndUnit,
        quantityUnits: quantityUnitCandidates(quantityAndUnit),
        priceAmountCurrency: amountColumn >= 0 ? String(row[amountColumn] || "").trim() : "",
      }];
    });
  });
}
