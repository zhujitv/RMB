import JSZip from "jszip";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import {
  supplierTaxContractQuantityNeedsTwoDecimals,
  supplierTaxContractQuantityText,
} from "./supplier-tax-contract-values";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number) {
  let name = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function inlineCell(row: number, column: number, value: unknown, style = 1) {
  return `<c r="${columnName(column)}${row}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function numberCell(row: number, column: number, value: string, style = 4) {
  return `<c r="${columnName(column)}${row}" s="${style}"><v>${xml(value)}</v></c>`;
}

function chineseCurrency(value: string) {
  const digits = "零壹贰叁肆伍陆柒捌玖";
  const units = ["", "拾", "佰", "仟"];
  const sectionUnits = ["", "万", "亿", "兆"];
  const [integerRaw, decimalRaw = ""] = value.split(".");
  const integer = BigInt(integerRaw || "0");
  let remaining = integer;
  let sectionIndex = 0;
  let result = "";
  let needsZero = false;
  while (remaining > BigInt(0)) {
    const section = Number(remaining % BigInt(10000));
    if (section === 0) {
      needsZero = Boolean(result);
    } else {
      let sectionText = "";
      let local = section;
      let zeroPending = false;
      for (let i = 0; i < 4; i += 1) {
        const digit = local % 10;
        if (digit) {
          sectionText = `${digits[digit]}${units[i]}${zeroPending ? "零" : ""}${sectionText}`;
          zeroPending = false;
        } else if (sectionText) zeroPending = true;
        local = Math.floor(local / 10);
      }
      result = `${sectionText}${sectionUnits[sectionIndex]}${needsZero ? "零" : ""}${result}`;
      needsZero = section < 1000;
    }
    remaining /= BigInt(10000);
    sectionIndex += 1;
  }
  const fraction = decimalRaw.padEnd(2, "0").slice(0, 2);
  const jiao = Number(fraction[0] || 0);
  const fen = Number(fraction[1] || 0);
  return `${result || "零"}元${jiao ? `${digits[jiao]}角` : ""}${fen ? `${digits[fen]}分` : jiao ? "" : "整"}`;
}

function worksheet(draft: SupplierTaxContractDraft) {
  const rows: string[] = [];
  rows.push(`<row r="1" ht="37.25" customHeight="1">${inlineCell(1, 1, "出口产品订货合同", 2)}</row>`);
  rows.push(`<row r="2" ht="20" customHeight="1">${inlineCell(2, 1, `供方：${draft.supplierName}`)}${inlineCell(2, 5, "合同编号：")}${inlineCell(2, 6, draft.contractNo)}</row>`);
  rows.push(`<row r="3" ht="20" customHeight="1">${inlineCell(3, 1, `需方：${draft.buyerName}`)}${inlineCell(3, 5, "签订日期：")}${inlineCell(3, 6, draft.signingDate)}</row>`);
  rows.push(`<row r="4">${inlineCell(4, 1, "签订地点：浙江诸暨")}</row>`);
  rows.push(`<row r="6">${["品名", "数量", "单位", "含税单价", "含税金额", "最晚交货日期"].map((value, index) => inlineCell(6, index + 1, value, 3)).join("")}</row>`);
  let row = 7;
  for (const item of draft.items) {
    const quantity = supplierTaxContractQuantityText(item.quantity, item.declaredQuantity);
    const quantityStyle = supplierTaxContractQuantityNeedsTwoDecimals(item.declaredQuantity, item.quantity) ? 11 : 12;
    rows.push(`<row r="${row}" ht="20" customHeight="1">${inlineCell(row, 1, item.productName, 8)}${numberCell(row, 2, quantity, quantityStyle)}${inlineCell(row, 3, item.unit, 8)}${numberCell(row, 4, item.unitPriceWithTax)}${numberCell(row, 5, item.amountWithTax)}${inlineCell(row, 6, draft.latestDeliveryDate, 6)}</row>`);
    row += 1;
  }
  const totalRow = row;
  rows.push(`<row r="${row}" ht="15" customHeight="1">${inlineCell(row, 1, "合计", 7)}${numberCell(row, 5, draft.totalAmountWithTax, 5)}${inlineCell(row, 6, "", 6)}</row>`);
  row += 1;
  const capitalRow = row;
  rows.push(`<row r="${row}" ht="30" customHeight="1">${inlineCell(row, 1, `人民币大写：${chineseCurrency(draft.totalAmountWithTax)}`, 8)}${[2, 3, 4, 5, 6].map((column) => inlineCell(row, column, "", 8)).join("")}</row>`);
  row += 1;
  const clauses = [
    { text: "二、交（提）货地点、方式：需方指定船公司仓库。允许溢短装。", rows: 1 },
    { text: "三、运杂费负担：运费由需方承担。", rows: 1 },
    { text: "四、包装要求及费用负担：包装必须符合出口商检要求,包装和装箱数量如不符,需方有权暂不付款。", rows: 1 },
    { text: "五、验收标准、方法及提出异议期限：属于国家法定商检的商品，需经商检合格后方可进仓。不属国家法定商检的商品，由需方按客户要求检验，合格后进仓。", rows: 2 },
    { text: "六、结算方式及期限：报关出口后,凭供方提供的增值税发票,30天内支付全部货款。", rows: 1 },
    { text: "七、质量要求、技术标准、供方对质量负责的条件和期限：需方订购的上列产品出口后，如因质量问题、包装等问题引起客户拒付、索赔，由供方承担所有损失。", rows: 1 },
    { text: "八、违约责任：违约方承担相应的违约责任。", rows: 1 },
    { text: "九、解决合同纠纷的方式：双方协商解决。如协商不成，任何一方均应向需方所在地人民法院起诉。", rows: 1 },
    { text: "十、未尽事宜，协商解决。", rows: 1 },
  ];
  const clauseMerges: string[] = [];
  for (const clause of clauses) {
    const endRow = row + clause.rows - 1;
    rows.push(`<row r="${row}" ht="26.25" customHeight="1">${inlineCell(row, 1, clause.text, 9)}</row>`);
    for (let continuation = row + 1; continuation <= endRow; continuation += 1) {
      rows.push(`<row r="${continuation}" ht="26.25" customHeight="1"></row>`);
    }
    clauseMerges.push(`A${row}:F${endRow}`);
    row = endRow + 1;
  }
  row += 1;
  const footerRows = [
    [`供方（盖章）：${draft.supplierName}`, `需方（盖章）：${draft.buyerName}`, 10],
    [`税号：${draft.supplierTaxNumber || "待补充"}`, `税号：${draft.buyerTaxNumber || "待补充"}`, 1],
    [`地址：${draft.supplierAddress || ""}`, `地址：${draft.buyerAddress || ""}`, 1],
    [`电话：${draft.supplierPhone || ""}`, `电话：${draft.buyerPhone || ""}`, 1],
    [`开户行：${draft.supplierBankName || ""}`, `开户行：${draft.buyerBankName || ""}`, 1],
    [`账号：${draft.supplierBankAccount || ""}`, `账号：${draft.buyerBankAccount || ""}`, 1],
  ] as const;
  footerRows.forEach(([supplierValue, buyerValue, style], index) => {
    const footerRow = row + index;
    rows.push(`<row r="${footerRow}" ht="20" customHeight="1">${inlineCell(footerRow, 1, supplierValue, style)}${inlineCell(footerRow, 4, buyerValue, style)}</row>`);
  });
  const lastRow = row + 5;
  const merges = [
    "A1:F1", "A2:D2", "A3:D3", "A4:F4", `A${totalRow}:D${totalRow}`,
    `A${capitalRow}:F${capitalRow}`, ...clauseMerges,
    ...footerRows.flatMap((_, index) => [`A${row + index}:C${row + index}`, `D${row + index}:F${row + index}`]),
  ];
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F${lastRow}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetFormatPr baseColWidth="10" defaultRowHeight="14"/><cols><col min="1" max="1" width="38" customWidth="1"/><col min="2" max="5" width="16" customWidth="1"/><col min="6" max="6" width="20" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData><mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="portrait" paperSize="9"/></worksheet>`;
}

export async function generateSupplierTaxContractXlsx(draft: SupplierTaxContractDraft) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder("_rels")?.file(".rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl")?.file("workbook.xml", `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="退税合同" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder("xl")?.file("styles.xml", `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.######"/><numFmt numFmtId="165" formatCode="0.00"/></numFmts><fonts count="4"><font><sz val="11"/><name val="宋体"/></font><font><b/><sz val="16"/><name val="宋体"/></font><font><b/><sz val="11"/><name val="宋体"/></font><font><sz val="12"/><name val="宋体"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="2" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="0" fillId="0" borderId="1" numFmtId="164" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="2" fillId="0" borderId="1" numFmtId="165" applyNumberFormat="1"/><xf fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="2" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="0" fillId="0" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="3" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="0" fillId="0" borderId="1" numFmtId="165" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="0" fillId="0" borderId="1" numFmtId="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  zip.folder("xl")?.folder("worksheets")?.file("sheet1.xml", worksheet(draft));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
