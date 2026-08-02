import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readCustomsDeclarationParserSource } from "./source-helpers.ts";
import {
  normalizeCustomsDate,
  parseCustomsDeclarationDetailText,
  parseCustomsDeclarationPdfBuffer,
  parseCustomsDeclarationText,
} from "../lib/customs-declaration-parser.ts";

function createTextPdf(lines: string[]) {
  const escapePdfText = (value: string) => value.replace(/([\\()])/g, "\\$1");
  const stream = lines
    .map((line, index) => `${index ? "0 -20 Td " : ""}(${escapePdfText(line)}) Tj`)
    .join(" ");
  const content = `BT /F1 12 Tf 72 720 Td ${stream} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("parses declaration number and declaration date near explicit labels", () => {
  const result = parseCustomsDeclarationText(`
    中华人民共和国海关出口货物报关单
    海关编号：223120241234567890
    出口日期：2024-05-10
    申报日期：2024年05月12日
    打印日期：2024-05-14
  `);

  assert.equal(result.customsDeclarationNo, "223120241234567890");
  assert.equal(result.customsDeclarationDate, "2024-05-12");
  assert.equal(result.customsDeclarationParseStatus, "SUCCESS");
  assert.equal(result.customsDeclarationParseSource, "AUTO_PDF_TEXT");
  assert.equal(result.customsDeclarationParseMessage, "已读取：\n✓ 报关单号\n✓ 申报日期");
  assert.deepEqual(Object.keys(result).sort(), [
    "customsDeclarationDate",
    "customsDeclarationNo",
    "customsDeclarationParseMessage",
    "customsDeclarationParseSource",
    "customsDeclarationParseStatus",
  ]);
});

test("normalizes full-width text and compact yyyyMMdd dates", () => {
  const result = parseCustomsDeclarationText(`
    预录入编号：ＺＪ２０２４０６０１０００１
    申报时间：２０２４０６０３
  `);

  assert.equal(result.customsDeclarationNo, "ZJ202406010001");
  assert.equal(result.customsDeclarationDate, "2024-06-03");
  assert.equal(result.customsDeclarationParseStatus, "SUCCESS");
});

test("parses English declaration number and declaration date labels", () => {
  const result = parseCustomsDeclarationText(`
    Customs Declaration No. 223120260002528894
    Declaration Date 2026/06/17
  `);

  assert.equal(result.customsDeclarationNo, "223120260002528894");
  assert.equal(result.customsDeclarationDate, "2026-06-17");
  assert.equal(result.customsDeclarationParseStatus, "SUCCESS");
});

test("extracts declaration fields from an uploaded text PDF", async () => {
  const pdf = createTextPdf([
    "Customs Declaration No. 223120260002528894",
    "Declaration Date 2026/06/17",
  ]);

  const result = await parseCustomsDeclarationPdfBuffer(pdf, { requireText: true });

  assert.equal(result.customsDeclarationNo, "223120260002528894");
  assert.equal(result.customsDeclarationDate, "2026-06-17");
  assert.equal(result.customsDeclarationParseStatus, "SUCCESS");
});

test("prefers declaration date over export, input and print dates", () => {
  const result = parseCustomsDeclarationText(`
    出口日期：2024-03-01
    录入日期：2024-03-02
    报关单号：A123456789012345678
    申报日期：2024-03-05
    打印日期：2024-03-06
  `);

  assert.equal(result.customsDeclarationNo, "A123456789012345678");
  assert.equal(result.customsDeclarationDate, "2024-03-05");
});

test("returns partial status when only one required field is found", () => {
  const result = parseCustomsDeclarationText("报关单号：223120241234567890\n出口日期：2024-05-10");

  assert.equal(result.customsDeclarationNo, "223120241234567890");
  assert.equal(result.customsDeclarationDate, "");
  assert.equal(result.customsDeclarationParseStatus, "PARTIAL");
  assert.match(result.customsDeclarationParseMessage, /申报日期/);
});

test("returns only declaration number and declaration date fields", () => {
  const result = parseCustomsDeclarationText(`
    报关单号：223120241234567890
    申报日期：2024-05-12
    境内发货人 提运单号 运输工具名称 运输方式 许可证号 监管方式 征免性质 生产销售单位
  `);

  assert.deepEqual(Object.keys(result).sort(), [
    "customsDeclarationDate",
    "customsDeclarationNo",
    "customsDeclarationParseMessage",
    "customsDeclarationParseSource",
    "customsDeclarationParseStatus",
  ]);
  assert.equal(result.customsDeclarationParseStatus, "SUCCESS");
});

test("does not use print date when declaration date label has no value", () => {
  const result = parseCustomsDeclarationText(`
    报关单号：223120241234567890
    申报日期：
    打印日期：2024-05-14
  `);

  assert.equal(result.customsDeclarationNo, "223120241234567890");
  assert.equal(result.customsDeclarationDate, "");
  assert.equal(result.customsDeclarationParseStatus, "PARTIAL");
});

test("returns failed status without blocking upload when fields are absent", () => {
  const result = parseCustomsDeclarationText("这是普通 PDF 文本，没有报关单字段。");

  assert.equal(result.customsDeclarationNo, "");
  assert.equal(result.customsDeclarationDate, "");
  assert.equal(result.customsDeclarationParseStatus, "FAILED");
  assert.equal(result.customsDeclarationParseMessage, "未读取到报关单号和申报日期，请手动填写");
});

test("normalizes valid declaration dates and rejects invalid dates", () => {
  assert.equal(normalizeCustomsDate("2024年2月29日"), "2024-02-29");
  assert.equal(normalizeCustomsDate("20230229"), "");
});

test("parses customs declaration item detail for tax refund calculation", () => {
  const result = parseCustomsDeclarationDetailText(`
    报关单号：223120241234567890
    申报日期：2024-05-12
    出口日期：2024-05-10
    境内发货人：杭州耐斯特家具有限公司
    成交方式：FOB
    币制：美元
    1 9403609990 木制餐桌 120 个 USD 3600.00
    2 9401619000 餐椅 240 个 FOB USD 4800.00
  `);

  assert.equal(result.exportDate, "2024-05-10");
  assert.equal(result.domesticShipper, "杭州耐斯特家具有限公司");
  assert.equal(result.tradeTerm, "FOB");
  assert.equal(result.currency, "USD");
  assert.equal(result.totalAmount, 8400);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    itemNo: "1",
    hsCode: "9403609990",
    productName: "木制餐桌",
    specification: "",
    quantity: 120,
    unit: "个",
    unitPrice: 0,
    totalAmount: 3600,
    tradeTerm: "FOB",
    currency: "USD",
    fobAmount: 3600,
    grossWeight: 0,
    netWeight: 0,
    originCountry: "",
    destinationCountry: "",
  });
});

test("parses multiline customs declaration item table rows", () => {
  const result = parseCustomsDeclarationDetailText(`
    中华人民共和国海关出口货物报关单
    海关编号 223120241234567890
    申报日期 2024-05-12
    成交方式 FOB
    币制 USD
    项号 商品编号 商品名称及规格型号 数量及单位 总价 币制
    1
    9403200000
    铝制工程结构件
    2866.71 千克
    USD 86588.10
    2
    7610900000
    铝制栏杆配件
    千克 3904.95
    USD 131554.34
  `);

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].itemNo, "1");
  assert.equal(result.items[0].hsCode, "9403200000");
  assert.equal(result.items[0].productName, "铝制工程结构件");
  assert.equal(result.items[0].quantity, 2866.71);
  assert.equal(result.items[0].unit, "千克");
  assert.equal(result.items[0].fobAmount, 86588.1);
  assert.equal(result.items[1].itemNo, "2");
  assert.equal(result.items[1].hsCode, "7610900000");
  assert.equal(result.items[1].productName, "铝制栏杆配件");
  assert.equal(result.items[1].quantity, 3904.95);
  assert.equal(result.items[1].unit, "千克");
  assert.equal(result.items[1].fobAmount, 131554.34);
});

test("filters non-product customs text out of declaration items", () => {
  const result = parseCustomsDeclarationDetailText(`
    报关单号：223120241234567890
    申报日期：2024-05-12
    成交方式 FOB
    币制 USD
    9403200000 铝制工程结构件 2866.71 千克 USD 86588.10
    备注：代理报关委托协议随附
    集装箱号：MSCU1234567
    境内货源地：杭州港
    提单号：BL123456789
  `);

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].productName, "铝制工程结构件");
  assert.equal(result.items[0].quantity, 2866.71);
  assert.equal(result.items[0].unit, "千克");
  assert.equal(result.items[0].totalAmount, 86588.1);
});

test("parser source does not reference bundled fixture documents", async () => {
  const source = readCustomsDeclarationParserSource();
  const packageJson = await fs.readFile(new URL("../package.json", import.meta.url), "utf8");
  const forbidden = [
    "05-versions" + "-space",
    ["test", "data"].join("/"),
    "sample " + "pdf",
    "demo " + "pdf",
  ];

  forbidden.forEach((pattern) => assert.equal(source.toLowerCase().includes(pattern), false));
  assert.match(source, /\["pdfjs-dist", "legacy", "build", "pdf\.mjs"\]\.join\("\/"\)/);
  assert.match(source, /\["pdfjs-dist", "legacy", "build", "pdf\.worker\.mjs"\]\.join\("\/"\)/);
  assert.match(source, /getBuiltinModule\("node:module"\)/);
  assert.match(source, /\.createRequire\(import\.meta\.url\)/);
  assert.match(source, /runtimeRequire\.resolve\(pdfJsModuleSpecifier\)/);
  assert.match(source, /runtimeRequire\.resolve\(pdfJsWorkerModuleSpecifier\)/);
  assert.match(source, /globalThis\.pdfjsWorker = await import/);
  assert.match(source, /new Worker\(PDF_TEXT_WORKER_SOURCE/);
  assert.match(source, /await worker\.terminate\(\)/);
  assert.match(source, /resourceLimits:/);
  assert.match(packageJson, /"pdfjs-dist"/);
  assert.doesNotMatch(packageJson, /"pdf2json"/);
  assert.doesNotMatch(packageJson, /"pdf-parse"/);
  assert.doesNotMatch(source, /pdf-parse|DOMMatrix|getScreenshot|render\(/);
  assert.match(source, /getTextContent\(\)/);
});
