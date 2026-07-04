import assert from "node:assert/strict";
import test from "node:test";
import { readTaxRefundModuleSource, readWorkspaceStylesSource } from "./source-helpers.ts";

const detailComponents = readTaxRefundModuleSource();
const uploadComponents = readTaxRefundModuleSource();
const workspaceStyles = readWorkspaceStylesSource();

test("tax refund factory documents use a full-width responsive supplier grid", () => {
  assert.match(detailComponents, /styles\.factoryDocumentSection/);
  assert.match(detailComponents, /styles\.factorySupplierGrid/);
  assert.match(uploadComponents, /styles\.factorySupplierCard/);
  assert.match(uploadComponents, /styles\.factorySupplierHeader/);
  assert.match(workspaceStyles, /\.factoryDocumentSection \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*\}/);
  assert.match(workspaceStyles, /\.factorySupplierGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*gap: 16px;[\s\S]*\}/);
  assert.match(workspaceStyles, /@media \(max-width: 900px\) \{[\s\S]*\.factorySupplierGrid \{[\s\S]*grid-template-columns: 1fr;[\s\S]*\}/);
});

test("tax refund factory document cards keep filenames truncated and actions inline", () => {
  assert.match(uploadComponents, /<strong title=\{supplierTitle\}>\{supplierTitle\}<\/strong>/);
  assert.match(uploadComponents, /<span title=\{costSummary\}>\{costSummary\}<\/span>/);
  assert.match(uploadComponents, /inlineUploadActions/);
  assert.match(workspaceStyles, /\.fileUploadFileName \{[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;[\s\S]*\}/);
  assert.match(workspaceStyles, /\.factorySupplierCard \.fileUploadActions \{[\s\S]*flex-wrap: nowrap;[\s\S]*\}/);
  assert.match(workspaceStyles, /\.factorySupplierCard \.fileUploadButton \{[\s\S]*height: 34px;[\s\S]*min-height: 34px;[\s\S]*\}/);
});
