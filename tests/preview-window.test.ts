import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readCostsModuleSource, readDomesticLogisticsModuleSource, readTaxRefundModuleSource, readWorkspaceStylesSource } from "./source-helpers.ts";

const previewRoute = readFileSync(
  "app/api/order-documents/[id]/preview/route.ts",
  "utf8",
);
const downloadRoute = readFileSync(
  "app/api/order-documents/[id]/download/route.ts",
  "utf8",
);
const filePreviewRoute = readFileSync(
  "app/api/files/[kind]/[id]/preview/route.ts",
  "utf8",
);
const fileDownloadRoute = readFileSync(
  "app/api/files/[kind]/[id]/download/route.ts",
  "utf8",
);
const fileMetadataRoute = readFileSync(
  "app/api/files/[kind]/[id]/route.ts",
  "utf8",
);
const orderDocumentRoute = readFileSync(
  "app/api/order-documents/[id]/route.ts",
  "utf8",
);
const documentPreviewPage = readFileSync(
  "app/documents/preview/[id]/page.tsx",
  "utf8",
);
const documentPreviewClient = readFileSync(
  "app/documents/preview/[id]/preview-client.tsx",
  "utf8",
);
const sharedComponents = readFileSync("app/components.tsx", "utf8");
const taxRefundRecognizeRoute = readFileSync(
  "app/api/tax-refund/[orderId]/recognize-customs-declaration/route.ts",
  "utf8",
);
const taxRefundModule = readTaxRefundModuleSource();
const domesticLogisticsModule = readDomesticLogisticsModuleSource();
const costsModule = readCostsModuleSource();
const logisticsModule = [
  "app/modules/LogisticsFeesModule.tsx",
  "app/modules/logistics-fees/invoice-groups-panel.tsx",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const uploadTexts = readFileSync("app/uploadTexts.ts", "utf8");
const orderDocumentsService = readFileSync(
  "lib/platform/order-documents.ts",
  "utf8",
);
const customsRecognitionService = readFileSync(
  "lib/platform/customs-recognition.ts",
  "utf8",
);
const sharedConstants = readFileSync(
  "lib/platform/shared-constants.ts",
  "utf8",
);
const sharedSerialization = readFileSync(
  "lib/platform/shared-serialization.ts",
  "utf8",
);
const fileCenter = readFileSync(
  "lib/platform/file-center.ts",
  "utf8",
);
const styles = readWorkspaceStylesSource();

test("preview route returns inline file streams with cache and nosniff headers", () => {
  assert.match(
    filePreviewRoute,
    /getManagedFilePreview\(request, actor, kind, id\)/,
  );
  assert.match(
    filePreviewRoute,
    /managedFileStreamHeaders\(\{[\s\S]*disposition: "inline"/,
  );
  assert.match(filePreviewRoute, /export async function HEAD/);
  assert.match(
    filePreviewRoute,
    /getManagedFilePreviewMetadata\(request, actor, kind, id\)/,
  );
  assert.match(previewRoute, /managedFileStreamHeaders/);
  assert.match(
    orderDocumentsService,
    /export async function getOrderDocumentPreviewMetadata/,
  );
  assert.match(orderDocumentsService, /headR2Object\(fileDocument\.storageKey\)/);
  assert.match(
    fileCenter,
    /filename="[^`]*"; filename\*=UTF-8''\$\{encodeURIComponent\(safeFileName\)\}/,
  );
  assert.match(
    sharedConstants,
    /document\.originalFileName,[\s\S]*document\.originalFilename,[\s\S]*document\.originalName,[\s\S]*document\.fileName,[\s\S]*generatedOrderDocumentFileName\(document\)/,
  );
  assert.doesNotMatch(filePreviewRoute, /attachment/);
  assert.match(fileCenter, /"Cache-Control": "private, max-age=300"/);
  assert.match(fileCenter, /"X-Content-Type-Options": "nosniff"/);
  assert.doesNotMatch(
    filePreviewRoute,
    /pdfjs|pdf2json|recognizeCustoms|parseCustoms|DOMMatrix/,
  );
});

test("download route returns attachment file streams", () => {
  assert.match(fileDownloadRoute, /getManagedFileDownload\(request, actor, kind, id\)/);
  assert.match(
    fileDownloadRoute,
    /managedFileStreamHeaders\(\{[\s\S]*disposition: "attachment"/,
  );
  assert.match(downloadRoute, /managedFileStreamHeaders/);
  assert.doesNotMatch(downloadRoute, /searchParams\.get\("disposition"\)/);
  assert.doesNotMatch(downloadRoute, /pdfContentDispositionHeader\("inline"/);
  assert.doesNotMatch(downloadRoute, /NextResponse\.redirect/);
});

test("preview route returns structured JSON errors when stream fails", () => {
  assert.match(
    previewRoute,
    /function previewErrorResponse\(error(?:: ErrorLike)?\)/,
  );
  assert.match(previewRoute, /Response\.json\(\{ error: message, code \}/);
  assert.match(previewRoute, /X-Preview-Error-Code/);
  assert.match(previewRoute, /文件暂时无法预览，请下载查看。/);
});

test("workspace modules use one file preview modal instead of preview tabs", () => {
  const downloadHref =
    /href=\{fileDownloadUrl\("order-document", document\.id\)\}/;
  const currentDocumentDownloadHref =
    /href=\{fileDownloadUrl\("order-document", currentDocument\.id\)\}/;
  assert.match(sharedComponents, /export function PdfPreviewButton/);
  assert.match(sharedComponents, /export function PdfPreviewDrawer/);
  assert.match(sharedComponents, /export function FilePreviewModal/);
  assert.match(fileMetadataRoute, /getManagedFileMetadata\(request, actor, kind, id\)/);
  assert.match(
    sharedComponents,
    /\/api\/files\/\$\{encodeURIComponent\(fileKind\)\}\/\$\{encodeURIComponent\(fileId\)\}\/preview/,
  );
  assert.match(sharedComponents, /method: "HEAD"/);
  assert.match(sharedComponents, /Content-Type/);
  assert.match(sharedComponents, /application\/pdf/);
  assert.match(sharedComponents, /image\/jpeg/);
  assert.match(sharedComponents, /image\/png/);
  assert.match(sharedComponents, /image\/webp/);
  assert.match(sharedComponents, /<iframe[\s\S]*src=\{previewUrl\}/);
  assert.match(sharedComponents, /styles\.paymentVoucherImageFrame/);
  assert.doesNotMatch(sharedComponents, /<object/);
  assert.doesNotMatch(sharedComponents, /data=\{previewUrl\}/);
  assert.match(sharedComponents, /文件暂时无法预览，请下载查看。/);
  assert.match(sharedComponents, /下载文件/);
  assert.match(
    sharedComponents,
    /surfaceClassName=\{styles\.paymentVoucherModal\}/,
  );
  assert.match(taxRefundModule, /PdfPreviewButton/);
  assert.match(domesticLogisticsModule, /PdfPreviewButton/);
  assert.match(costsModule, /PdfPreviewButton/);
  assert.match(logisticsModule, /PdfPreviewButton/);
  assert.match(taxRefundModule, downloadHref);
  assert.match(domesticLogisticsModule, currentDocumentDownloadHref);
  assert.match(costsModule, downloadHref);
  assert.doesNotMatch(
    `${taxRefundModule}\n${domesticLogisticsModule}\n${costsModule}\n${logisticsModule}`,
    /\/documents\/preview|window\.open\(/,
  );
  assert.doesNotMatch(
    `${taxRefundModule}\n${domesticLogisticsModule}\n${costsModule}\n${logisticsModule}`,
    /target="_blank"[^>]*>预览/,
  );
  assert.doesNotMatch(
    sharedComponents,
    /react-pdf|pdfjs-dist|GlobalWorkerOptions|workerSrc|DOMMatrix/,
  );
});

test("document preview page sets the browser title from document metadata", () => {
  assert.match(documentPreviewPage, /export async function generateMetadata/);
  assert.match(
    documentPreviewPage,
    /getOrderDocumentMetadata\(request, actor, documentId\)/,
  );
  assert.match(documentPreviewPage, /return \{ title \}/);
  assert.match(
    documentPreviewPage,
    /<DocumentPreviewClient documentId=\{id\} initialFileName=\{initialFileName\} \/>/,
  );
  assert.match(
    documentPreviewClient,
    /fetch\(`\/api\/files\/order-document\/\$\{encodedId\}`/,
  );
  assert.match(documentPreviewClient, /displayFileName/);
  assert.match(documentPreviewClient, /downloadFileName/);
  assert.match(documentPreviewClient, /document\.title = initialFileName/);
  assert.match(documentPreviewClient, /document\.title = nextFileName/);
  assert.match(documentPreviewClient, /\/preview`/);
  assert.match(documentPreviewClient, /method: "HEAD"/);
  assert.match(documentPreviewClient, /Content-Type/);
  assert.match(documentPreviewClient, /application\/pdf/);
  assert.match(documentPreviewClient, /<iframe[\s\S]*src=\{previewUrl\}/);
  assert.doesNotMatch(documentPreviewClient, /<object/);
  assert.doesNotMatch(documentPreviewClient, /data=\{previewUrl\}/);
  assert.match(documentPreviewClient, /minHeight: "calc\(100vh - 80px\)"/);
  assert.match(documentPreviewClient, /文件暂时无法预览，请下载查看。/);
  assert.match(documentPreviewClient, /下载文件/);
  assert.match(orderDocumentRoute, /export async function GET/);
  assert.match(
    orderDocumentRoute,
    /getOrderDocumentMetadata\(request, actor, id\)/,
  );
  assert.match(sharedSerialization, /displayFileName/);
  assert.match(sharedSerialization, /downloadFileName/);
  assert.doesNotMatch(documentPreviewClient, /document\.title = "preview"/);
  assert.doesNotMatch(documentPreviewClient, /PDF Preview|Document Preview/);
});

test("tax refund detail uses one file table for preview download and delete", () => {
  assert.match(taxRefundModule, /function DocumentFileTable\(/);
  assert.match(
    taxRefundModule,
    /<th>文件名<\/th>[\s\S]*<th>上传人<\/th>[\s\S]*<th>上传时间<\/th>[\s\S]*<th>识别状态<\/th>[\s\S]*<th>预览<\/th>[\s\S]*<th>下载<\/th>[\s\S]*<th>删除<\/th>/,
  );
  assert.match(
    taxRefundModule,
    /<PdfPreviewButton documentId=\{document\.id\} fileName=\{document\.fileName \|\| ""\} \/>/,
  );
  assert.match(
    taxRefundModule,
    /onClick=\{\(\) => onDelete\(orderId, document\)\}/,
  );
  assert.match(taxRefundModule, /确定删除该文件？/);
  assert.match(taxRefundModule, /删除后需要重新上传。/);
  assert.match(taxRefundModule, /setDetail\(\(current\) =>/);
  assert.match(
    taxRefundModule,
    /documents: \(current\.documents \|\| \[\]\)\.filter\(\(item\) => item\.id !== document\.id\)/,
  );
  assert.match(
    taxRefundModule,
    /<DocumentFileTable[\s\S]*canRecognize=\{false\}/,
  );
  assert.match(taxRefundModule, /重新识别报关单/);
});

test("tax refund detail keeps upload delete and recognition updates local", () => {
  assert.doesNotMatch(taxRefundModule, /window\.location\.reload/);
  assert.match(
    taxRefundModule,
    /function patchUploadedDocument\(orderId: string, document: TaxDocument\)/,
  );
  assert.match(
    taxRefundModule,
    /function patchCustomsRecognition\(orderId: string, result: CustomsRecognitionResult \| null \| undefined\)/,
  );
  assert.match(
    taxRefundModule,
    /patchUploadedDocument\(orderId, uploadedDocument\)/,
  );
  assert.match(taxRefundModule, /patchCustomsRecognition\(order\.id, result\)/);
  assert.match(taxRefundModule, /patchCustomsRecognition\(orderId, result\)/);
  assert.match(
    taxRefundModule,
    /documents: \(current\.documents \|\| \[\]\)\.filter\(\(item\) => item\.id !== document\.id\)/,
  );
  assert.match(taxRefundModule, /delete next\[document\.id\]/);
  assert.doesNotMatch(
    taxRefundModule,
    /await fetchDetail\(orderId\);\s*await loadRows\(page, submittedKeyword, mode\);/,
  );
  assert.doesNotMatch(
    taxRefundModule,
    /await fetchDetail\(order\.id\);\s*await loadRows\(page, submittedKeyword, mode\);/,
  );
});

test("tax refund detail drawer close only clears local detail state", () => {
  const closeMatch = taxRefundModule.match(
    /function closeDetailDrawer\(\) \{([\s\S]*?)\n  \}/,
  );
  assert.ok(closeMatch, "closeDetailDrawer should exist");
  const closeBody = closeMatch[1];

  assert.match(closeBody, /detailRequestTokenRef\.current \+= 1/);
  assert.match(closeBody, /setDetailRow\(null\)/);
  assert.match(closeBody, /setDetailOrderId\(""\)/);
  assert.match(closeBody, /setDetail\(null\)/);
  assert.match(closeBody, /setDetailError\(""\)/);
  assert.match(closeBody, /setDetailLoading\(false\)/);
  assert.match(closeBody, /setPendingDetailTarget\(""\)/);
  assert.match(closeBody, /setCustomsFilePicker\(null\)/);
  assert.match(closeBody, /setManualShippingOrder\(null\)/);
  assert.doesNotMatch(
    closeBody,
    /loadRows\(|fetchDetail\(|window\.location|location\.href|router\.refresh|reloadData|reload\(/,
  );
  assert.match(taxRefundModule, /onClose=\{closeDetailDrawer\}/);
});

test("tax refund export documents use compact cards instead of wide tables", () => {
  assert.match(
    taxRefundModule,
    /<strong>出口资料上传<\/strong>[\s\S]*styles\.fileUploadGrid[\s\S]*<FileUploadCard/,
  );
  assert.match(taxRefundModule, /function FileUploadCard\(/);
  assert.match(taxRefundModule, /document=\{latestTaxDocument\(/);
  assert.match(
    taxRefundModule,
    /styles\.fileUploadFileName[\s\S]*title=\{document\.fileName \|\| "-"\}/,
  );
  assert.match(
    taxRefundModule,
    /styles\.fileUploadActionLabel\}>操作：<\/span>/,
  );
  assert.match(
    uploadTexts,
    /export const UPLOAD_REPLACE_TEXT = "替换\/上传新版PDF";/,
  );
  assert.match(
    taxRefundModule,
    /uploading \? "上传中\.\.\." : UPLOAD_REPLACE_TEXT/,
  );
  assert.match(styles, /\.fileUploadSection \{[\s\S]*grid-column: 1 \/ -1;/);
  assert.match(
    styles,
    /\.fileUploadGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*gap: 16px;/,
  );
  assert.match(
    styles,
    /\.fileUploadFileName \{[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 920px\) \{[\s\S]*\.fileUploadGrid \{[\s\S]*grid-template-columns: 1fr;/,
  );
});

test("tax refund customs uploads share the file upload card layout", () => {
  assert.match(
    taxRefundModule,
    /<strong>报关资料上传<\/strong>[\s\S]*styles\.fileUploadGrid[\s\S]*TAX_CUSTOMS_UPLOAD_TYPES\.map/,
  );
  assert.match(
    taxRefundModule,
    /canRecognize = documentType\.value === "CUSTOMS_ENTRY_FORM" && canRecognizeCustoms/,
  );
  assert.match(taxRefundModule, /onRecognize=\{onRecognize\}/);
  assert.match(taxRefundModule, /recognitionStatus=\{recognitionStatus\}/);
  assert.match(
    taxRefundModule,
    /function TaxUploadItem\([\s\S]*<FileUploadCard/,
  );
  assert.doesNotMatch(taxRefundModule, /customsDocumentBlock/);
  assert.doesNotMatch(taxRefundModule, /customsUploadBlocks/);
});

test("detail drawers and cards now own file management layout", () => {
  assert.match(styles, /\.taxRefundDrawer \{/);
  assert.match(styles, /\.taxRefundDrawerHeader \{/);
  assert.match(styles, /\.taxRefundDrawerBody \{/);
  assert.match(styles, /\.detailCard \{/);
  assert.match(styles, /\.detailCard \* \{/);
});

test("domestic logistics customs declaration keeps one current upload", () => {
  assert.match(domesticLogisticsModule, /UPLOAD_REPLACE_TEXT/);
  assert.match(
    domesticLogisticsModule,
    /latestUploadedDocument\(matchedDocuments\)/,
  );
  assert.match(orderDocumentsService, /documentType: "CUSTOMS_ENTRY_FORM"/);
  assert.match(orderDocumentsService, /id: \{ not: created\.id \}/);
  assert.match(orderDocumentsService, /data: \{ deletedAt: replacedAt \}/);
  assert.match(orderDocumentsService, /softDeleteFileAssetBySource\(/);
});

test("tax refund customs recognition stays focused on current declaration fields", () => {
  assert.match(taxRefundModule, /latestTaxDocument\(matchedDocuments\)/);
  assert.match(taxRefundModule, /UPLOAD_REPLACE_TEXT/);
  assert.doesNotMatch(
    `${taxRefundModule}\n${domesticLogisticsModule}`,
    /重新上传报关单 PDF|重新上传PDF|替换文件/,
  );
  assert.doesNotMatch(
    `${taxRefundModule}\n${domesticLogisticsModule}`,
    /"上传新版PDF"/,
  );
  assert.match(
    taxRefundModule,
    /\/api\/tax-refund\/\$\{encodeURIComponent\(order\.id\)\}\/recognize-customs-declaration/,
  );
  assert.match(
    customsRecognitionService,
    /customsDeclarationNo: result\.customsDeclarationNo \|\| ""/,
  );
  assert.match(
    customsRecognitionService,
    /customsDeclarationDate: result\.customsDeclarationDate \|\| ""/,
  );
  assert.doesNotMatch(
    taxRefundModule,
    /运输方式|车牌号|起运地|到达地|货物名称/,
  );
});

test("tax refund re-recognition uses order route and surfaces specific backend reasons", () => {
  assert.match(
    taxRefundRecognizeRoute,
    /recognizeOrderCustomsDeclaration\(request, actor, orderId\)/,
  );
  assert.match(
    taxRefundRecognizeRoute,
    /apiError\(error, "重新识别报关单失败"\)/,
  );
  assert.match(taxRefundModule, /setDetailError\(message\)/);
  assert.doesNotMatch(taxRefundModule, /\/api\/tax-refunds\/customs\/reparse/);
  assert.match(customsRecognitionService, /未找到报关单文件，请先上传报关单。/);
  assert.match(customsRecognitionService, /文件不存在/);
  assert.match(customsRecognitionService, /文件无法读取/);
  assert.match(
    customsRecognitionService,
    /PDF未提取到文字，请手工填写报关单号和申报日期。/,
  );
  assert.match(customsRecognitionService, /未识别到报关单号/);
  assert.match(customsRecognitionService, /未识别到申报日期/);
  assert.match(
    customsRecognitionService,
    /hasCustomsRecognitionValue\(fields\)/,
  );
  assert.match(
    customsRecognitionService,
    /customsUpdateData\(fields, status, message, source\)/,
  );
});

test("admin can delete uploaded customs documents with confirmation", () => {
  assert.match(
    domesticLogisticsModule,
    /const canDeleteCustomsDocuments = canWritePermission\(currentUser, permissions, "documents", \["管理员"\]\)/,
  );
  assert.match(domesticLogisticsModule, /title: "确定删除该文件？"/);
  assert.match(domesticLogisticsModule, /message: "删除后需要重新上传。"/);
  assert.match(
    domesticLogisticsModule,
    /onClick=\{\(\) => onDelete\(currentDocument\)\}/,
  );
  assert.match(domesticLogisticsModule, /confirmLabel: "删除文件"/);
  assert.match(domesticLogisticsModule, /variant: "danger"/);
  assert.match(
    domesticLogisticsModule,
    /setNotice\(result\.message \|\| "已删除文件"\)/,
  );
  assert.match(domesticLogisticsModule, /删除失败，请重试/);
});

test("deleting customs declaration clears recognized declaration fields", () => {
  assert.match(orderDocumentRoute, /message: "已删除文件"/);
  assert.match(orderDocumentRoute, /apiError\(error, "删除失败，请重试"\)/);
  assert.match(orderDocumentsService, /文件不存在或已删除/);
  assert.match(
    orderDocumentsService,
    /isCustomsDeclarationDocumentType\(before\.documentType\)/,
  );
  assert.match(orderDocumentsService, /customsDeclarationNo: null/);
  assert.match(orderDocumentsService, /customsDeclarationDate: null/);
  assert.match(orderDocumentsService, /customsParseStatus: null/);
});
