import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readSettingsModuleSource, readTaxRefundModuleSource } from "./source-helpers.ts";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const service = readFileSync("lib/platform/supplier-document-requests.ts", "utf8");
const notificationEngine = readFileSync("lib/platform/notification-engine.ts", "utf8");
const supplierModule = readFileSync("app/modules/SupplierDocumentsModule.tsx", "utf8");
const supplierRequestRoute = readFileSync("app/api/supplier-document-requests/[id]/route.ts", "utf8");
const supplierRequestDocumentRoute = readFileSync("app/api/supplier-document-requests/[id]/documents/route.ts", "utf8");
const taxModule = readTaxRefundModuleSource();
const settingsModule = readSettingsModuleSource();
const menu = readFileSync("app/menu.ts", "utf8");
const permissions = readFileSync("lib/platform/shared-permission-data.ts", "utf8");
const repairSupplierReturnDocumentsScript = readFileSync("scripts/repair-supplier-return-documents.mjs", "utf8");
const legacyProductSupplierRole = `产品供应商${"账号"}`;
const legacyProductSupplierMenuPattern = new RegExp(`${legacyProductSupplierRole}: \\["supplierDocuments", "manual"\\]`);

test("supplier document request schema links supplier uploads to tax refund documents", () => {
  assert.match(schema, /model SupplierDocumentRequest/);
  assert.match(schema, /allowFactoryDocumentUpload\s+Boolean\s+@default\(false\)\s+@map\("allow_factory_document_upload"\)/);
  assert.match(schema, /factoryDocumentRequestId\s+String\?\s+@map\("factory_document_request_id"\)/);
  assert.match(schema, /documents\s+OrderDocument\[\]/);
  assert.match(schema, /completedAt\s+DateTime\?\s+@map\("completed_at"\)/);
  assert.match(schema, /completedById\s+String\?\s+@map\("completed_by"\)/);
  assert.match(schema, /completedBy\s+User\?\s+@relation\("SupplierDocumentRequestCompletedBy"/);
});

test("supplier document workflow uses existing factory tax document types", () => {
  assert.match(service, /SUPPLIER_PURCHASE_CONTRACT/);
  assert.match(service, /SUPPLIER_INVOICE/);
  assert.match(service, /scheduleTaxRefundCompletenessRefresh\(row\.orderId\)/);
  assert.match(service, /syncCostInvoiceStatus/);
  assert.match(service, /readManagedUploadFile\(input\.file, "pdf", "supplier-document\.pdf"\)/);
  assert.match(service, /readValidatedExcelTemplate/);
  assert.match(service, /orderId: row\.orderId/);
  assert.match(service, /supplierId: row\.supplierId/);
  assert.match(service, /factoryDocumentRequestId: row\.id/);
  assert.match(service, /source: row\.source/);
  assert.match(service, /documentType === "SUPPLIER_INVOICE"/);
  assert.match(service, /orderId: row\.orderId,[\s\S]*supplierId: row\.supplierId,[\s\S]*deletedAt: null/);
});

test("supplier callback email uses formal PDF-only request template", () => {
  assert.match(notificationEngine, /SUPPLIER_DOCUMENT_REQUEST/);
  assert.match(notificationEngine, /尊敬的 \{supplierName\}：/);
  assert.match(notificationEngine, /您有一份订单资料需要回传，请按以下要求及时办理。/);
  assert.match(service, /工厂采购合同（盖章扫描件，PDF）/);
  assert.match(service, /工厂增值税发票（PDF）/);
  assert.match(service, /本邮件已附上预填好的 Excel 合同样本，请打印合同并加盖公司公章，扫描后回传。/);
  assert.match(notificationEngine, /请严格按照附件中的合同内容开具工厂增值税发票，确保发票内容与合同内容一致。/);
  assert.match(notificationEngine, /所有上传文件仅支持 PDF 格式。/);
  assert.match(notificationEngine, /本邮件由系统自动发送，请勿直接回复。/);
  assert.match(service, /sendNotificationEmail\(\{/);
});

test("product supplier callback email attaches only matching cost payment voucher", () => {
  assert.match(service, /function paymentVoucherAttachmentFileName/);
  assert.match(service, /return `汇款水单\.\$\{extension\}`/);
  assert.match(service, /async function latestProductSupplierPaymentVoucherAttachment\(orderId: string, supplierId: string\)/);
  assert.match(service, /sourceType: \{ not: "LOGISTICS_EXPENSE" \}/);
  assert.match(service, /costType: \{ in: FACTORY_SUPPLIER_COST_TYPES \}/);
  assert.match(service, /paymentVoucherStorageKey: \{ not: null \}/);
  assert.match(service, /findActiveFileAssetBySource\(/);
  assert.match(service, /const storageKey = asset\?\.storageKey \|\| voucherCost\.paymentVoucherStorageKey/);
  assert.match(service, /readR2Object\(storageKey\)/);
  assert.match(service, /已付款的汇款水单已随邮件附件发送，请核对后回传对应资料。/);
  assert.match(service, /paymentVoucherAttached: Boolean\(paymentVoucherAttachment\)/);
  assert.match(service, /\.\.\.\(paymentVoucherAttachment \? \[paymentVoucherAttachment\] : \[\]\)/);
});

test("supplier portal does not render customer identity fields", () => {
  assert.doesNotMatch(supplierModule, /customerName|customerFullName|customerShortName|客户简称|客户全称/);
  assert.doesNotMatch(service, /customerName|customerFullName|customerShortName/);
  assert.match(supplierModule, /订单号/);
  assert.match(supplierModule, /资料回传/);
  assert.match(supplierModule, /本页面仅支持 PDF 文件/);
  assert.match(supplierModule, /仅支持 PDF，单个文件最大/);
  assert.match(supplierModule, /回传账号/);
  assert.match(supplierModule, /styles\.supplierDocumentsPage/);
  assert.match(supplierModule, /styles\.supplierDocumentTaskCard/);
  assert.match(supplierModule, /styles\.supplierDocumentUploadCard/);
  assert.match(supplierModule, /选择 PDF 文件/);
  assert.match(supplierModule, /下载合同样本/);
  assert.doesNotMatch(supplierModule, /fileUploadEmpty/);
  assert.match(menu, /回传工厂采购合同和增值税发票 PDF/);
});

test("admin tax refund drawer can notify product suppliers without replacing tax upload flow", () => {
  assert.match(taxModule, /通知产品供应商回传/);
  assert.match(taxModule, /\/api\/supplier-document-requests/);
  assert.match(taxModule, /allowFactoryDocumentUpload/);
  assert.match(taxModule, /documentMatchesFactoryCostSlot\(document, cost, sameSupplierFactoryCostCount\)/);
  assert.doesNotMatch(taxModule, /document\.costId === cost\.id \|\| Boolean\(cost\.supplierId && document\.supplierId === cost\.supplierId\)/);
});

test("tax refund factory document slots are bound by cost item", () => {
  assert.match(taxModule, /factoryDocumentTargetKey\(item\.costId, item\.documentType \|\| ""\)/);
  assert.match(taxModule, /function documentMatchesFactoryCostSlot/);
  assert.match(taxModule, /if \(document\.costId\) return document\.costId === cost\.id/);
  assert.match(taxModule, /sameSupplierFactoryCostCount === 1 && Boolean\(cost\.supplierId && document\.supplierId === cost\.supplierId\)/);
  assert.match(taxModule, /工厂货款 \$\{displayIndex\}/);
});

test("supplier settings and menus expose the controlled factory upload switch", () => {
  assert.match(settingsModule, /allowFactoryDocumentUpload/);
  assert.match(settingsModule, /允许供应商资料回传/);
  assert.match(menu, /supplierDocuments/);
  assert.match(permissions, /supplierDocuments/);
});

test("product supplier callback uses a dedicated supplier account role", () => {
  assert.match(permissions, /产品供应商: \["supplierDocuments", "manual"\]/);
  assert.match(menu, /产品供应商: \["supplierDocuments", "manual"\]/);
  assert.doesNotMatch(permissions, legacyProductSupplierMenuPattern);
  assert.doesNotMatch(menu, legacyProductSupplierMenuPattern);
  assert.match(permissions, /SUPPLIER_DOCUMENT_ROLES/);
  assert.match(service, /isProductSupplierOperatorRole/);
  assert.match(service, /assertWrite\(actor, "supplierDocuments"\)/);
  assert.match(service, /assertRead\(actor, "supplierDocuments"\)/);
  assert.match(settingsModule, /FACTORY_SUPPLIER_ACCOUNT_ROLE = "产品供应商"/);
  assert.match(settingsModule, /if \(FACTORY_SUPPLIER_ACCOUNT_ROLES\.includes\(role\)\) return PRODUCT_SUPPLIER_TYPES\.includes\(supplier\.supplierType \|\| ""\)/);
  assert.doesNotMatch(settingsModule, /PRODUCT_SUPPLIER_TYPES\.includes\(supplier\.supplierType \|\| ""\) && supplier\.allowFactoryDocumentUpload/);
  assert.match(permissions, /工厂供应商账号: \["supplierDocuments", "manual"\]/);
  assert.match(menu, /工厂供应商账号: \["supplierDocuments", "manual"\]/);
  assert.doesNotMatch(permissions, /物流供应商: \["supplierDocuments", "domesticLogistics", "manual"\]/);
});

test("admin can delete only untouched supplier document requests", () => {
  assert.match(supplierRequestRoute, /export async function DELETE/);
  assert.match(supplierRequestRoute, /deleteSupplierDocumentRequest\(request, actor, id\)/);
  assert.match(service, /export async function deleteSupplierDocumentRequest/);
  assert.match(service, /actor\?\.role !== "管理员"/);
  assert.match(service, /只有管理员可以删除资料回传任务/);
  assert.match(service, /row\.status !== "待上传" \|\| supplierDocumentRequestHasStartedUpload\(row\)/);
  assert.match(service, /该任务已开始回传资料，无法删除。/);
  assert.match(service, /uploadStatus[^\\n]*!== "PENDING" \|\| uploadProgress > 0/);
  assert.match(service, /tx\.orderDocument\.updateMany/);
  assert.match(service, /tx\.supplierDocumentRequest\.update/);
  assert.match(service, /deletedAt: now/);
  assert.match(service, /deleteR2Object\(row\.templateStorageKey/);
  assert.match(supplierModule, /task\.canDelete/);
  assert.match(supplierModule, /删除资料回传任务/);
  assert.match(supplierModule, /确定删除该资料回传任务吗？删除后无法恢复。/);
  assert.match(supplierModule, /method: "DELETE"/);
  assert.match(supplierModule, /const nextTotal = Math\.max\(0, total - 1\)/);
  assert.match(supplierModule, /await loadRows\(nextPage, pageSize\)/);
});

test("supplier document request list uses server-side pagination", () => {
  const supplierRequestListRoute = readFileSync("app/api/supplier-document-requests/route.ts", "utf8");
  assert.match(service, /const \{ page, pageSize \} = pageParams\(query, 10, 50\)/);
  assert.match(service, /prisma\.supplierDocumentRequest\.count\(\{ where \}\)/);
  assert.match(service, /skip: \(page - 1\) \* pageSize/);
  assert.match(service, /take: pageSize/);
  assert.match(service, /pageResult\(rowsWithOcr\.map\(\(row\) => serializeSupplierDocumentRequest\(row, actor\)\), total, page, pageSize\)/);
  assert.doesNotMatch(service, /take: 100/);
  assert.match(supplierRequestListRoute, /requests: result\.rows/);
  assert.match(supplierRequestListRoute, /pagination: \{/);
  assert.match(supplierRequestListRoute, /summary: result\.summary/);
  assert.match(supplierModule, /new URLSearchParams\(\{ page: String\(nextPage\), pageSize: String\(nextPageSize\) \}\)/);
  assert.match(supplierModule, /<strong>\{total\}<\/strong>/);
  assert.match(supplierModule, /total=\{total\}/);
  assert.match(supplierModule, /await loadRows\(nextPage, pageSize\)/);
  assert.doesNotMatch(supplierModule, /rows\.slice\(start, start \+ pageSize\)/);
});

test("supplier document list failure is not rendered as an empty task list", () => {
  assert.match(supplierModule, /const \[loadError, setLoadError\]/);
  assert.match(supplierModule, /setLoadError\(message\)/);
  assert.match(supplierModule, /读取失败：/);
  assert.match(supplierModule, /重试/);
  assert.match(supplierModule, /!\s*loadError \? \(/);
  assert.match(supplierModule, /\) : loadError \? \(\s*null\s*\)/);
  assert.match(service, /attachSupplierDocumentOcrTasks\(reconciledRows\)/);
  assert.match(service, /供应商资料回传OCR状态读取失败，已跳过OCR附加信息/);
});

test("supplier document request completion requires OCR qualification or manual confirmation", () => {
  const completionService = readFileSync("lib/platform/supplier-document-request-completion.ts", "utf8");
  assert.match(completionService, /function isOcrQualified/);
  assert.match(completionService, /OCR_STATUS_PASSED/);
  assert.match(completionService, /VALIDATION_CONFIRMED/);
  assert.match(completionService, /const uploaded = document\?\.uploadStatus === "SUCCESS"/);
  assert.match(completionService, /const qualified = uploaded && isOcrQualified\(task\)/);
  assert.match(completionService, /allQualified \? "已完成" : anyStarted \? "部分上传" : "待上传"/);
  assert.match(service, /status: nextStatus, completedAt: null, completedById: null/);
  assert.match(service, /safeRefreshSupplierDocumentRequestCompletion\(row\.id\)/);
});

test("supplier return repair script backfills business document associations", () => {
  assert.match(repairSupplierReturnDocumentsScript, /factoryDocumentRequestId: \{ not: null \}/);
  assert.match(repairSupplierReturnDocumentsScript, /refreshTaxRefundCompleteness/);
  assert.match(repairSupplierReturnDocumentsScript, /syncCostInvoiceStatus/);
  assert.match(repairSupplierReturnDocumentsScript, /data\.orderId = task\.orderId/);
  assert.match(repairSupplierReturnDocumentsScript, /data\.supplierId = task\.supplierId \|\| null/);
  assert.match(repairSupplierReturnDocumentsScript, /data\.relatedModule = "SUPPLIER"/);
  assert.match(repairSupplierReturnDocumentsScript, /affectedOrderIds\.add\(task\.orderId\)/);
  assert.match(repairSupplierReturnDocumentsScript, /affectedSupplierInvoicePairs\.set/);
  assert.match(repairSupplierReturnDocumentsScript, /source: "SUPPLIER_RETURN"/);
  assert.match(repairSupplierReturnDocumentsScript, /刷新订单完整度/);
  assert.match(repairSupplierReturnDocumentsScript, /同步成本发票状态/);
});

test("supplier callback upload only auto-binds an unambiguous factory cost", () => {
  assert.match(service, /resolveUniqueFactoryCostForSupplierReturn/);
  assert.match(service, /take: 2/);
  assert.match(service, /return costs\.length === 1 \? costs\[0\] : null/);
  assert.match(service, /costId: uniqueFactoryCost\?\.id \|\| null/);
  assert.match(service, /factoryCostSlotsForSupplierRequest/);
  assert.match(service, /factoryCostSlots/);
  assert.match(supplierModule, /factoryCostSlots/);
  assert.match(supplierModule, /const defaultUploadCostId = factoryCostSlots\.length === 1/);
  assert.match(supplierModule, /const uploadCostId = document\?\.costId \|\| defaultUploadCostId/);
  assert.match(supplierModule, /supplierUploadKey\(task\.id, documentType, uploadCostId\)/);
  assert.match(supplierModule, /formData\.append\("costId", costId\)/);
  assert.match(supplierRequestDocumentRoute, /costId: String\(formData\.get\("costId"\) \|\| ""\)/);
});

test("supplier document cards merge upload slots with uploaded files by document type", () => {
  assert.match(supplierModule, /uniqueRequiredDocumentTypes\(requiredTypes\)\.map/);
  assert.match(supplierModule, /function normalizeSupplierDocumentType/);
  assert.match(supplierModule, /PURCHASE_CONTRACT/);
  assert.match(supplierModule, /VAT_INVOICE/);
  assert.match(supplierModule, /latestDocumentByType\(task\.documents \|\| \[\], documentType\)/);
  assert.match(supplierModule, /supplierDocumentTypeCandidates\(document\)\.includes\(normalizedType\)/);
  assert.match(supplierModule, /supplierDocumentFileName\(document\)/);
  assert.match(supplierModule, /文件记录存在，但文件无法访问/);
  assert.match(supplierModule, /重新上传 PDF 文件/);
  assert.match(supplierModule, /<SupplierDocumentOcrPanel/);
  assert.match(supplierModule, /<PdfPreviewButton documentId=\{document\.id\}/);
  assert.match(supplierModule, /fileDownloadUrl\("order-document", document\.id\)/);
  assert.doesNotMatch(supplierModule, /function supplierDocumentUploadSlots/);
  assert.doesNotMatch(supplierModule, /UNMATCHED_SUPPLIER_DOCUMENT_SLOT_ID/);
  assert.doesNotMatch(supplierModule, /已上传资料/);
  assert.doesNotMatch(supplierModule, /uploadSlots\.flatMap/);
});

test("supplier document backend normalizes legacy document type aliases before matching", () => {
  assert.match(service, /function normalizeSupplierReturnDocumentType/);
  assert.match(service, /PURCHASE_CONTRACT/);
  assert.match(service, /VAT_INVOICE/);
  assert.match(service, /requiredTypes\.includes\(normalizeSupplierReturnDocumentType\(document\.documentType\)/);
  assert.match(service, /const documentType = normalizeSupplierReturnDocumentType\(nonEmpty\(input\.documentType\)\) as OrderDocumentType/);
});

test("supplier document upload is not blocked when OCR task creation fails", () => {
  assert.match(service, /let ocrWarning = ""/);
  assert.match(service, /供应商回传资料上传成功但OCR任务创建失败/);
  assert.match(service, /message: ocrWarning \? `上传成功；\$\{ocrWarning\}` : "上传成功"/);
  assert.doesNotMatch(service, /const ocrTask = await createSupplierDocumentOcrTaskForUpload\(document\.id\);[\s\S]{0,180}throw error/);
});
