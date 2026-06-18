import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const previewRoute = readFileSync("app/api/order-documents/[id]/preview/route.ts", "utf8");
const taxRefundModule = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
const domesticLogisticsModule = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const orderDocumentsService = readFileSync("lib/platform/order-documents.ts", "utf8");
const styles = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("preview route returns inline file streams with cache and nosniff headers", () => {
  assert.match(previewRoute, /"Content-Disposition": `inline; filename="/);
  assert.match(previewRoute, /"Cache-Control": "private, max-age=300"/);
  assert.match(previewRoute, /"X-Content-Type-Options": "nosniff"/);
  assert.match(previewRoute, /const contentType = mimeType \|\| document\.mimeType \|\| "application\/pdf"/);
});

test("preview route returns structured JSON errors when stream fails", () => {
  assert.match(previewRoute, /function previewErrorResponse\(error(?:: ErrorLike)?\)/);
  assert.match(previewRoute, /Response\.json\(\{ error: message, code \}/);
  assert.match(previewRoute, /X-Preview-Error-Code/);
  assert.match(previewRoute, /PDF 预览失败，请下载原文件查看/);
});

test("workspace modules use preview links instead of legacy preview windows", () => {
  const previewHref = /href=\{`\/api\/order-documents\/\$\{encodeURIComponent\(document\.id\)\}\/preview`\}/;
  assert.match(taxRefundModule, previewHref);
  assert.match(domesticLogisticsModule, previewHref);
  assert.match(costsModule, previewHref);
});

test("detail drawers and cards now own file management layout", () => {
  assert.match(styles, /\.taxRefundDrawer \{/);
  assert.match(styles, /\.taxRefundDrawerHeader \{/);
  assert.match(styles, /\.taxRefundDrawerBody \{/);
  assert.match(styles, /\.detailCard \{/);
  assert.match(styles, /\.detailCard \* \{/);
});

test("domestic logistics customs declaration keeps one current upload", () => {
  assert.match(domesticLogisticsModule, /重新上传报关单 PDF/);
  assert.match(domesticLogisticsModule, /latestUploadedDocument\(matchedDocuments\)/);
  assert.match(orderDocumentsService, /documentType: "CUSTOMS_ENTRY_FORM"/);
  assert.match(orderDocumentsService, /id: \{ not: created\.id \}/);
  assert.match(orderDocumentsService, /data: \{ deletedAt: new Date\(\) \}/);
});

test("tax refund customs recognition stays focused on current declaration fields", () => {
  assert.match(taxRefundModule, /latestTaxDocument\(matchedDocuments\)/);
  assert.match(taxRefundModule, /重新上传报关单 PDF/);
  assert.match(taxRefundModule, /customsDeclarationNo: result\.customsDeclarationNo \|\| ""/);
  assert.match(taxRefundModule, /customsDeclarationDate: result\.customsDeclarationDate \|\| ""/);
  assert.doesNotMatch(taxRefundModule, /运输方式|车牌号|起运地|到达地|货物名称/);
});

test("admin can delete uploaded customs documents with confirmation", () => {
  assert.match(domesticLogisticsModule, /const canDeleteCustomsDocuments = canWritePermission\(currentUser, permissions, "documents", \["管理员"\]\)/);
  assert.match(domesticLogisticsModule, /title: "确认删除文件？"/);
  assert.match(domesticLogisticsModule, /confirmLabel: "删除文件"/);
  assert.match(domesticLogisticsModule, /variant: "danger"/);
});
