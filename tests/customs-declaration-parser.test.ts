import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  normalizeCustomsDate,
  parseCustomsDeclarationText,
} from "../lib/customs-declaration-parser.ts";

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
  assert.equal(result.customsDeclarationParseMessage, "已识别：\n✓ 报关单号\n✓ 申报日期");
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
  assert.equal(result.customsDeclarationParseMessage, "文件已上传，但未自动识别到申报日期/海关编号，请手工填写。");
});

test("normalizes valid declaration dates and rejects invalid dates", () => {
  assert.equal(normalizeCustomsDate("2024年2月29日"), "2024-02-29");
  assert.equal(normalizeCustomsDate("20230229"), "");
});

test("parser source does not reference bundled fixture documents", async () => {
  const source = await fs.readFile(new URL("../lib/customs-declaration-parser.ts", import.meta.url), "utf8");
  const forbidden = [
    "05-versions" + "-space",
    ["test", "data"].join("/"),
    "sample " + "pdf",
    "demo " + "pdf",
  ];

  forbidden.forEach((pattern) => assert.equal(source.toLowerCase().includes(pattern), false));
  assert.match(source, /import\(["']pdf-parse["']\)/);
  assert.doesNotMatch(source, /pdf-parse\/lib\/pdf-parse\.js/);
  assert.match(source, /parser\.getText\(/);
});
