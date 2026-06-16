import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const previewRoute = readFileSync("app/api/order-documents/[id]/preview/route.ts", "utf8");
const taxRefundModule = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
const domesticLogisticsModule = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
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
