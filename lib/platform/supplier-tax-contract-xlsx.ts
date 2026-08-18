import JSZip from "jszip";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";

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
  rows.push(`<row r="1" ht="28" customHeight="1">${inlineCell(1, 1, "出口产品订货合同", 2)}</row>`);
  rows.push(`<row r="2">${inlineCell(2, 1, `供方：${draft.supplierName}`)}${inlineCell(2, 5, `合同编号：${draft.contractNo}`)}</row>`);
  rows.push(`<row r="3">${inlineCell(3, 1, `需方：${draft.buyerName}`)}${inlineCell(3, 5, `签订日期：${draft.signingDate}`)}</row>`);
  rows.push(`<row r="4">${inlineCell(4, 1, `签订地点：${draft.signingPlace || "中国"}`)}</row>`);
  rows.push(`<row r="6">${["品名", "数量", "单位", "含税单价", "含税金额", "最晚交货日期"].map((value, index) => inlineCell(6, index + 1, value, 3)).join("")}</row>`);
  let row = 7;
  for (const item of draft.items) {
    rows.push(`<row r="${row}">${inlineCell(row, 1, item.productName)}${numberCell(row, 2, item.quantity)}${inlineCell(row, 3, item.unit)}${numberCell(row, 4, item.unitPriceWithTax)}${numberCell(row, 5, item.amountWithTax)}${inlineCell(row, 6, draft.latestDeliveryDate)}</row>`);
    row += 1;
  }
  rows.push(`<row r="${row}">${inlineCell(row, 1, "合计", 3)}${numberCell(row, 5, draft.totalAmountWithTax, 5)}</row>`);
  row += 1;
  rows.push(`<row r="${row}">${inlineCell(row, 1, `人民币大写：${chineseCurrency(draft.totalAmountWithTax)}`)}${inlineCell(row, 5, `币种：${draft.currency}`)}</row>`);
  row += 2;
  const clauses = [
    "一、品名、数量和单位以经人工审核确认的报关单商品信息为准。",
    ...(draft.sourceType === "FACTORY_PURCHASE_TRANSITION_SETTLEMENT" ? ["本合同由已发货报关历史订单的冻结过渡结算凭证生成。"] : []),
    "二、合同金额按本订单实际装柜计价数量计算，留仓及未装运数量不计入货款。",
    "三、供方须按本合同开具增值税发票；发票品名、数量、单位及价税合计必须与本合同一致。",
    "四、付款方式：按双方确认的采购付款条件执行。",
    "五、本合同经双方确认并签章后生效，扫描件与原件具有同等效力。",
  ];
  for (const clause of clauses) {
    rows.push(`<row r="${row}" ht="24" customHeight="1">${inlineCell(row, 1, clause)}</row>`);
    row += 1;
  }
  row += 1;
  rows.push(`<row r="${row}">${inlineCell(row, 1, `供方（盖章）：${draft.supplierName}`)}${inlineCell(row, 4, `需方（盖章）：${draft.buyerName}`)}</row>`);
  rows.push(`<row r="${row + 1}">${inlineCell(row + 1, 1, `税号：${draft.supplierTaxNumber || "待补充"}`)}${inlineCell(row + 1, 4, `税号：${draft.buyerTaxNumber || "待补充"}`)}</row>`);
  rows.push(`<row r="${row + 2}">${inlineCell(row + 2, 1, `地址：${draft.supplierAddress || ""}`)}${inlineCell(row + 2, 4, `地址：${draft.buyerAddress || ""}`)}</row>`);
  rows.push(`<row r="${row + 3}">${inlineCell(row + 3, 1, `电话：${draft.supplierPhone || ""}`)}${inlineCell(row + 3, 4, `电话：${draft.buyerPhone || ""}`)}</row>`);
  rows.push(`<row r="${row + 4}">${inlineCell(row + 4, 1, `开户行：${draft.supplierBankName || ""}`)}${inlineCell(row + 4, 4, `开户行：${draft.buyerBankName || ""}`)}</row>`);
  rows.push(`<row r="${row + 5}">${inlineCell(row + 5, 1, `账号：${draft.supplierBankAccount || ""}`)}${inlineCell(row + 5, 4, `账号：${draft.buyerBankAccount || ""}`)}</row>`);
  const lastRow = row + 5;
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="38" customWidth="1"/><col min="2" max="5" width="16" customWidth="1"/><col min="6" max="6" width="20" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData><mergeCells count="${clauses.length + 7}"><mergeCell ref="A1:F1"/><mergeCell ref="A2:D2"/><mergeCell ref="A3:D3"/><mergeCell ref="A4:F4"/><mergeCell ref="A${7 + draft.items.length}:D${7 + draft.items.length}"/>${clauses.map((_, index) => `<mergeCell ref="A${10 + draft.items.length + index}:F${10 + draft.items.length + index}"/>`).join("")}<mergeCell ref="A${row}:C${row}"/><mergeCell ref="D${row}:F${row}"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="portrait" paperSize="9" fitToWidth="1" fitToHeight="1"/></worksheet>`;
}

export async function generateSupplierTaxContractXlsx(draft: SupplierTaxContractDraft) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder("_rels")?.file(".rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl")?.file("workbook.xml", `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="退税合同" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder("xl")?.file("styles.xml", `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="宋体"/></font><font><b/><sz val="16"/><name val="宋体"/></font><font><b/><sz val="11"/><name val="宋体"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="6"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="2" fillId="1" borderId="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="0" fillId="0" borderId="1" numFmtId="4" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="2" fillId="0" borderId="1" numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  zip.folder("xl")?.folder("worksheets")?.file("sheet1.xml", worksheet(draft));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
