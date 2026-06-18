import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const previewRoute = readFileSync("app/api/order-documents/[id]/preview/route.ts", "utf8");
const downloadRoute = readFileSync("app/api/order-documents/[id]/download/route.ts", "utf8");
const orderDocumentRoute = readFileSync("app/api/order-documents/[id]/route.ts", "utf8");
const taxRefundRecognizeRoute = readFileSync("app/api/tax-refund/[orderId]/recognize-customs-declaration/route.ts", "utf8");
const taxRefundModule = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
const domesticLogisticsModule = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const orderDocumentsService = readFileSync("lib/platform/order-documents.ts", "utf8");
const customsRecognitionService = readFileSync("lib/platform/customs-recognition.ts", "utf8");
const styles = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("preview route returns inline file streams with cache and nosniff headers", () => {
  assert.match(previewRoute, /"Content-Type": "application\/pdf"/);
  assert.match(previewRoute, /"Content-Disposition": `inline; filename="/);
  assert.match(previewRoute, /document\.originalFilename \|\| document\.originalName \|\| document\.fileName/);
  assert.doesNotMatch(previewRoute, /attachment/);
  assert.match(previewRoute, /"Cache-Control": "private, max-age=300"/);
  assert.match(previewRoute, /"X-Content-Type-Options": "nosniff"/);
  assert.doesNotMatch(previewRoute, /pdfjs|pdf2json|recognizeCustoms|parseCustoms|DOMMatrix/);
});

test("download route returns attachment file streams", () => {
  assert.match(downloadRoute, /getOrderDocumentDownload\(request, actor, id\)/);
  assert.match(downloadRoute, /"Content-Type": "application\/pdf"/);
  assert.match(downloadRoute, /"Content-Disposition": `attachment; filename="/);
  assert.match(downloadRoute, /document\.originalFilename \|\| document\.originalName \|\| document\.fileName/);
  assert.doesNotMatch(downloadRoute, /NextResponse\.redirect/);
  assert.doesNotMatch(downloadRoute, /inline/);
});

test("preview route returns structured JSON errors when stream fails", () => {
  assert.match(previewRoute, /function previewErrorResponse\(error(?:: ErrorLike)?\)/);
  assert.match(previewRoute, /Response\.json\(\{ error: message, code \}/);
  assert.match(previewRoute, /X-Preview-Error-Code/);
  assert.match(previewRoute, /PDF 预览失败，请下载原文件查看/);
});

test("workspace modules use preview links instead of legacy preview windows", () => {
  const previewHref = /href=\{`\/api\/order-documents\/\$\{encodeURIComponent\(document\.id\)\}\/preview`\}/;
  const downloadHref = /href=\{`\/api\/order-documents\/\$\{encodeURIComponent\(document\.id\)\}\/download`\}/;
  assert.match(taxRefundModule, /window\.open\(`\/api\/order-documents\/\$\{encodeURIComponent\(documentId\)\}\/preview`, "_blank"/);
  assert.match(domesticLogisticsModule, previewHref);
  assert.match(costsModule, previewHref);
  assert.match(taxRefundModule, downloadHref);
  assert.match(domesticLogisticsModule, downloadHref);
  assert.match(costsModule, downloadHref);
  assert.doesNotMatch(taxRefundModule, /\/download`} target="_blank"/);
});

test("tax refund detail uses one file table for preview download and delete", () => {
  assert.match(taxRefundModule, /function DocumentFileTable\(/);
  assert.match(taxRefundModule, /<th>文件名<\/th>[\s\S]*<th>上传人<\/th>[\s\S]*<th>上传时间<\/th>[\s\S]*<th>识别状态<\/th>[\s\S]*<th>预览<\/th>[\s\S]*<th>下载<\/th>[\s\S]*<th>删除<\/th>/);
  assert.match(taxRefundModule, /onClick=\{\(\) => openDocumentPreview\(document\.id\)\}/);
  assert.match(taxRefundModule, /onClick=\{\(\) => onDelete\(orderId, document\)\}/);
  assert.match(taxRefundModule, /确定删除该文件？/);
  assert.match(taxRefundModule, /删除后需要重新上传。/);
  assert.match(taxRefundModule, /setDetail\(\(current\) =>/);
  assert.match(taxRefundModule, /documents: \(current\.documents \|\| \[\]\)\.filter\(\(item\) => item\.id !== document\.id\)/);
  assert.match(taxRefundModule, /<DocumentFileTable[\s\S]*canRecognize=\{false\}/);
  assert.match(taxRefundModule, /重新识别报关单/);
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
  assert.match(taxRefundModule, /visibleDocuments\.length \? "替换当前PDF" : "上传PDF文件"/);
  assert.doesNotMatch(taxRefundModule, /重新上传报关单 PDF|替换\/上传新版PDF|替换当前 PDF/);
  assert.match(taxRefundModule, /\/api\/tax-refund\/\$\{encodeURIComponent\(order\.id\)\}\/recognize-customs-declaration/);
  assert.match(customsRecognitionService, /customsDeclarationNo: result\.customsDeclarationNo \|\| ""/);
  assert.match(customsRecognitionService, /customsDeclarationDate: result\.customsDeclarationDate \|\| ""/);
  assert.doesNotMatch(taxRefundModule, /运输方式|车牌号|起运地|到达地|货物名称/);
});

test("tax refund re-recognition uses order route and surfaces specific backend reasons", () => {
  assert.match(taxRefundRecognizeRoute, /recognizeOrderCustomsDeclaration\(request, actor, orderId\)/);
  assert.match(taxRefundRecognizeRoute, /apiError\(error, "重新识别报关单失败"\)/);
  assert.match(taxRefundModule, /setDetailError\(message\)/);
  assert.doesNotMatch(taxRefundModule, /\/api\/tax-refunds\/customs\/reparse/);
  assert.match(customsRecognitionService, /未找到报关单文件，请先上传报关单。/);
  assert.match(customsRecognitionService, /文件不存在/);
  assert.match(customsRecognitionService, /文件无法读取/);
  assert.match(customsRecognitionService, /PDF未提取到文字，请手工填写报关单号和申报日期。/);
  assert.match(customsRecognitionService, /未识别到报关单号/);
  assert.match(customsRecognitionService, /未识别到申报日期/);
  assert.match(customsRecognitionService, /hasCustomsRecognitionValue\(fields\)/);
  assert.match(customsRecognitionService, /customsUpdateData\(fields, status, message, source\)/);
});

test("admin can delete uploaded customs documents with confirmation", () => {
  assert.match(domesticLogisticsModule, /const canDeleteCustomsDocuments = canWritePermission\(currentUser, permissions, "documents", \["管理员"\]\)/);
  assert.match(domesticLogisticsModule, /title: "确定删除该文件？"/);
  assert.match(domesticLogisticsModule, /message: "删除后需要重新上传。"/);
  assert.match(domesticLogisticsModule, /onClick=\{\(\) => onDelete\(currentCustomsDeclaration\)\}/);
  assert.match(domesticLogisticsModule, /confirmLabel: "删除文件"/);
  assert.match(domesticLogisticsModule, /variant: "danger"/);
  assert.match(domesticLogisticsModule, /setNotice\(result\.message \|\| "已删除文件"\)/);
  assert.match(domesticLogisticsModule, /删除失败，请重试/);
});

test("deleting customs declaration clears recognized declaration fields", () => {
  assert.match(orderDocumentRoute, /message: "已删除文件"/);
  assert.match(orderDocumentRoute, /apiError\(error, "删除失败，请重试"\)/);
  assert.match(orderDocumentsService, /文件不存在或已删除/);
  assert.match(orderDocumentsService, /isCustomsDeclarationDocumentType\(before\.documentType\)/);
  assert.match(orderDocumentsService, /customsDeclarationNo: null/);
  assert.match(orderDocumentsService, /customsDeclarationDate: null/);
  assert.match(orderDocumentsService, /customsParseStatus: null/);
});
