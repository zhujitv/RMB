import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleSource = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const css = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("domestic logistics list keeps compact accepted columns", () => {
  for (const label of ["订单号", "客户简称", "到达地", "运输货物名称", "物流状态", "详情"]) {
    assert.match(moduleSource, new RegExp(`<th>${label}</th>`));
  }
  assert.match(moduleSource, /<td colSpan=\{6\}>/);
});

test("domestic logistics detail keeps per-order fee entry and customs uploads", () => {
  assert.match(moduleSource, /录入费用/);
  assert.match(moduleSource, /CustomsDocumentPanel/);
  assert.match(moduleSource, /集装箱运输明细/);
  assert.match(moduleSource, /出口发票备注/);
});

test("domestic logistics transport detail keeps multi-container fields", () => {
  for (const field of ["containerNo", "truckPlateNo", "trailerPlateNo", "departurePlace", "arrivalPlace", "cargoName"]) {
    assert.match(moduleSource, new RegExp(field));
  }
});

test("shared workspace styles provide full-width expandable detail cards", () => {
  assert.match(css, /\.detailRow td[\s\S]*padding: 0;/);
  assert.match(css, /\.detailCard[\s\S]*border-radius: 12px;/);
  assert.match(css, /\.detailCard[\s\S]*overflow-x: hidden;/);
  assert.match(css, /\.detailGrid[\s\S]*grid-template-columns:/);
});
