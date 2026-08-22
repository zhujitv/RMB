import assert from "node:assert/strict";
import test from "node:test";
import {
  findSupplierContractSealTextBox,
  supplierContractSealPlacement,
} from "../lib/platform/supplier-contract-seal-position-math.ts";

test("buyer seal anchor follows each contract label instead of a fixed page position", () => {
  const upperAnchor = findSupplierContractSealTextBox([
    { text: "供方（盖章）：安徽供应商", x: 50, y: 420, width: 180, height: 18 },
    { text: "需方（盖章）：浙江莱诺建材有限公司", x: 330, y: 438, width: 210, height: 18 },
  ]);
  const lowerAnchor = findSupplierContractSealTextBox([
    { text: "需方", x: 285, y: 165, width: 36, height: 16 },
    { text: "（盖章）：", x: 323, y: 164, width: 62, height: 16 },
  ]);
  assert.equal(upperAnchor?.x, 330);
  assert.equal(upperAnchor?.y, 438);
  assert.equal(lowerAnchor?.x, 285);
  assert.equal(lowerAnchor?.y, 164);

  const page = { width: 595, height: 842 };
  const upperPlacement = supplierContractSealPlacement(
    { ...upperAnchor!, pageIndex: 0, source: "TENCENT_OCR" },
    page,
    0.98,
  );
  const lowerPlacement = supplierContractSealPlacement(
    { ...lowerAnchor!, pageIndex: 0, source: "TENCENT_OCR" },
    page,
    0.98,
  );
  assert.ok(upperPlacement.y > lowerPlacement.y + 200);
  assert.ok(upperPlacement.x > 350 && upperPlacement.x < 420);
  assert.ok(lowerPlacement.x > 250 && lowerPlacement.x < 360);
});

test("seal anchor refuses unrelated text instead of guessing", () => {
  assert.equal(findSupplierContractSealTextBox([
    { text: "合同编号：PO7/PO10", x: 420, y: 760, width: 120, height: 16 },
    { text: "供方（盖章）：安徽供应商", x: 50, y: 420, width: 180, height: 18 },
  ]), null);
});

test("seal placement remains inside the selected PDF page", () => {
  const placement = supplierContractSealPlacement(
    { pageIndex: 2, x: 570, y: 8, width: 40, height: 12, source: "PDF_TEXT" },
    { width: 595, height: 842 },
    1,
  );
  assert.equal(placement.pageIndex, 2);
  assert.ok(placement.x + placement.width <= 595 - 16);
  assert.equal(placement.y, 16);
});
