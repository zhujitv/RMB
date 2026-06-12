import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("app.js", "utf8");
const css = readFileSync("styles.css", "utf8");
const publicApp = readFileSync("public/app.js", "utf8");
const publicCss = readFileSync("public/styles.css", "utf8");

test("domestic logistics editor uses near full screen dimensions", () => {
  for (const source of [css, publicCss]) {
    assert.match(source, /\.domestic-logistics-panel[\s\S]*width: 96vw;[\s\S]*max-width: 1800px;[\s\S]*height: 95vh;/);
    assert.match(source, /\.domestic-logistics-scroll[\s\S]*overflow-x: hidden;/);
  }
});

test("transport detail table keeps required desktop column order", () => {
  const expected = ["集装箱号", "车牌号", "挂车车牌", "起运日期", "起运地", "到达地", "运输货物名称", "备注", "操作"];
  for (const label of expected) assert.match(app, new RegExp(`<span>${label}</span>`));
  assert.match(app, /class="domestic-transport-table-head"/);
  assert.match(css, /minmax\(130px, 160px\)[\s\S]*minmax\(112px, 140px\)[\s\S]*minmax\(130px, 150px\)[\s\S]*minmax\(160px, 220px\)/);
});

test("domestic logistics documents render as type status action table", () => {
  for (const label of ["资料类型", "状态与文件名", "操作"]) {
    assert.match(app, new RegExp(`<span>${label}</span>`));
  }
  assert.match(app, /class="domestic-document-table-head"/);
  assert.match(css, /grid-template-columns: 180px minmax\(0, 1fr\) 240px;/);
});

test("responsive breakpoint switches domestic logistics detail to cards below 1200px", () => {
  assert.match(css, /@media \(max-width: 1199px\)[\s\S]*\.domestic-transport-table-head,[\s\S]*\.domestic-document-table-head[\s\S]*display: none;/);
  assert.match(css, /@media \(max-width: 1199px\)[\s\S]*\.domestic-transport-item-row[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.domestic-transport-item-row,[\s\S]*\.expanded-transport-item/);
});

test("app and public domestic logistics layout code stay synchronized", () => {
  assert.equal(app.includes("domestic-document-table-head"), publicApp.includes("domestic-document-table-head"));
  assert.equal(css.includes("max-width: 1800px"), publicCss.includes("max-width: 1800px"));
});
