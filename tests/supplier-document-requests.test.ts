import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readCssModuleGraphSource, readNotificationEngineSource, readSettingsModuleSource, readSupplierDocumentRequestsSource, readSupplierDocumentsModuleSource, readTaxRefundModuleSource } from "./source-helpers.ts";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const service = readSupplierDocumentRequestsSource();
const uploadService = readFileSync("lib/platform/supplier-document-request-upload.ts", "utf8");
const notificationEngine = readNotificationEngineSource();
const supplierModule = readSupplierDocumentsModuleSource();
const supplierCreateDialog = readFileSync("app/modules/supplier-documents/create-request-dialog.tsx", "utf8");
const supplierDocumentStyles = readCssModuleGraphSource("app/styles/workspace-shell/supplier-documents.module.css");
const supplierCostCandidatesRoute = readFileSync("app/api/supplier-document-requests/cost-candidates/route.ts", "utf8");
const supplierRequestListRoute = readFileSync("app/api/supplier-document-requests/route.ts", "utf8");
const supplierRequestRoute = readFileSync("app/api/supplier-document-requests/[id]/route.ts", "utf8");
const supplierRequestStatsRoute = readFileSync("app/api/supplier-document-requests/stats/route.ts", "utf8");
const supplierRequestDocumentRoute = readFileSync("app/api/supplier-document-requests/[id]/documents/route.ts", "utf8");
const supplierRequestTemplateRoute = readFileSync("app/api/supplier-document-requests/[id]/template/route.ts", "utf8");
const taxModule = readTaxRefundModuleSource();
const settingsModule = readSettingsModuleSource();
const menu = readFileSync("app/menu.ts", "utf8");
const permissions = readFileSync("lib/platform/shared-permission-data.ts", "utf8");
const repairSupplierReturnDocumentsScript = readFileSync("scripts/repair-supplier-return-documents.mjs", "utf8");
const repairTaxRelationService = readFileSync("lib/platform/repair-tax-relations.ts", "utf8");
const legacyProductSupplierRole = `产品供应商${"账号"}`;
const legacyProductSupplierMenuPattern = new RegExp(`${legacyProductSupplierRole}: \\["supplierDocuments", "manual"\\]`);

test("supplier document request schema links supplier uploads to tax refund documents", () => {
  assert.match(schema, /model SupplierDocumentRequest/);
  assert.match(schema, /costId\s+String\?\s+@map\("cost_id"\)/);
  assert.match(schema, /purchaseOrderNo\s+String\?\s+@map\("purchase_order_no"\)/);
  assert.match(schema, /cost\s+OrderCost\?\s+@relation\(fields: \[costId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(schema, /@@index\(\[costId\]\)/);
  assert.match(schema, /@@index\(\[purchaseOrderNo\]\)/);
  assert.match(schema, /@@index\(\[createdAt\]\)/);
  assert.match(schema, /@@index\(\[factoryDocumentRequestId, deletedAt\], map: "order_documents_factory_request_deleted_idx"\)/);
  assert.match(schema, /allowFactoryDocumentUpload\s+Boolean\s+@default\(false\)\s+@map\("allow_factory_document_upload"\)/);
  assert.match(schema, /factoryDocumentRequestId\s+String\?\s+@map\("factory_document_request_id"\)/);
  assert.match(schema, /documents\s+OrderDocument\[\]/);
  assert.match(schema, /completedAt\s+DateTime\?\s+@map\("completed_at"\)/);
  assert.match(schema, /completedById\s+String\?\s+@map\("completed_by"\)/);
  assert.match(schema, /deletedAt\s+DateTime\?\s+@map\("deleted_at"\)/);
  assert.match(schema, /deletedById\s+String\?\s+@map\("deleted_by"\)/);
  assert.match(schema, /completedBy\s+User\?\s+@relation\("SupplierDocumentRequestCompletedBy"/);
  assert.match(schema, /deletedBy\s+User\?\s+@relation\("SupplierDocumentRequestDeletedBy"/);
  const costUniqueMigration = readFileSync("prisma/migrations/20260705110000_supplier_document_request_cost_unique/migration.sql", "utf8");
  assert.match(costUniqueMigration, /supplier_document_requests_active_cost_unique/);
  assert.match(costUniqueMigration, /WHERE "cost_id" IS NOT NULL[\s\S]*"deleted_at" IS NULL[\s\S]*"status" <> 'DELETED'/);
});

test("supplier document workflow uses existing factory tax document types", () => {
  assert.match(service, /SUPPLIER_PURCHASE_CONTRACT/);
  assert.match(service, /SUPPLIER_INVOICE/);
  assert.match(service, /scheduleTaxRefundCompletenessRefresh\(row\.orderId\)/);
  assert.match(service, /syncCostInvoiceStatus/);
  assert.match(service, /readManagedUploadFile\(input\.file, "pdf", "supplier-document\.pdf"\)/);
  assert.match(service, /readValidatedExcelTemplate/);
  assert.match(service, /合同样本仅支持 \.xls 或 \.xlsx Excel 文件/);
  assert.match(service, /MAX_EXCEL_TEMPLATE_BYTES = 4 \* 1024 \* 1024/);
  assert.match(service, /LEGACY_EXCEL_TEMPLATE_MIME/);
  assert.match(service, /signature !== "d0cf11e0"/);
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
  assert.match(service, /function isPaidFactorySupplierCost/);
  assert.match(service, /paymentStatus === "已支付" \|\| cost\.paymentStatus === "部分支付"/);
  assert.match(service, /async function selectedProductSupplierPaymentVoucherAttachment\(cost: FactorySupplierReturnCost\)/);
  assert.match(service, /if \(!isPaidFactorySupplierCost\(cost\)\) return null/);
  assert.match(service, /findActiveFileAssetBySource\(/);
  assert.match(service, /const storageKey = asset\?\.storageKey \|\| cost\.paymentVoucherStorageKey \|\| ""/);
  assert.match(service, /if \(!storageKey\) return null/);
  assert.match(service, /readR2Object\(storageKey\)/);
  assert.match(service, /safeSelectedProductSupplierPaymentVoucherAttachment\(factoryCost\)/);
  assert.match(service, /costId: factoryCost\.id/);
  assert.match(service, /resolveUniqueFactoryCostForSupplierReturn\(row\.orderId, row\.supplierId, nonEmpty\(row\.costId\)\)/);
  assert.match(service, /供应商资料回传重发付款凭证成本匹配失败，已跳过水单附件/);
  assert.match(service, /safeSelectedProductSupplierPaymentVoucherAttachment\(factoryCost\)/);
  assert.match(service, /if \(paymentVoucherAttachment\) attachments\.push\(paymentVoucherAttachment\)/);
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
  assert.match(supplierModule, /styles\.supplierDocumentTaskDetailMobileHeader/);
  assert.match(supplierModule, /onClick=\{onToggle\}[\s\S]*关闭/);
  assert.match(supplierModule, /选择 PDF 文件/);
  assert.match(supplierModule, /下载合同样本/);
  assert.doesNotMatch(supplierModule, /fileUploadEmpty/);
  assert.match(menu, /回传工厂采购合同和增值税发票 PDF/);
});

test("supplier document mobile detail opens as a fixed foreground drawer", () => {
  assert.match(supplierDocumentStyles, /\.supplierDocumentTaskDetailMobileHeader/);
  assert.match(supplierDocumentStyles, /@media \(max-width: 720px\)[\s\S]*\.supplierDocumentTaskDetail\s*\{[\s\S]*position: fixed/);
  assert.match(supplierDocumentStyles, /@media \(max-width: 720px\)[\s\S]*\.supplierDocumentTaskDetail\s*\{[\s\S]*100dvh/);
  assert.match(supplierDocumentStyles, /@media \(max-width: 520px\)[\s\S]*\.supplierDocumentTaskActions\s*\{[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(96px, 1fr\)\)/);
  assert.match(supplierDocumentStyles, /@media \(max-width: 640px\)[\s\S]*\.supplierDocumentRequestDialog\s*\{[\s\S]*calc\(100dvh - 24px\)/);
});

test("supplier document reminders are owned by the supplier return module", () => {
  assert.doesNotMatch(taxModule, /通知产品供应商回传/);
  assert.doesNotMatch(taxModule, /\/api\/supplier-document-requests/);
  assert.match(taxModule, /前往资料回传/);
  assert.match(taxModule, /产品供应商资料缺失/);
  assert.match(taxModule, /onOpenSupplierDocuments/);
  assert.match(supplierModule, /重新发送邮件/);
  assert.match(supplierModule, /发送状态/);
  assert.match(supplierModule, /发起资料回传通知/);
  assert.match(supplierModule, /CreateSupplierDocumentRequestDialog/);
  assert.match(supplierCreateDialog, /\/api\/supplier-document-requests/);
  assert.match(supplierCreateDialog, /\/api\/supplier-document-requests\/cost-candidates/);
  assert.match(supplierCreateDialog, /templateFile/);
  assert.match(supplierCreateDialog, /EXCEL_TEMPLATE_ACCEPT/);
  assert.match(supplierCreateDialog, /\.xls/);
  assert.match(supplierCreateDialog, /\.xlsx/);
  assert.match(supplierCreateDialog, /formData\.append\("costId", selectedCost\.id\)/);
  assert.match(supplierCreateDialog, /请选择已登记的工厂供应商成本/);
  assert.doesNotMatch(supplierCreateDialog, /\/api\/receivables\/search/);
  assert.doesNotMatch(supplierCreateDialog, /\/api\/suppliers\/search/);
  assert.match(supplierCreateDialog, /formData\.append\("requiredDocumentTypes", requiredTypes\.join\(","\)\)/);
  assert.match(supplierCreateDialog, /SUPPLIER_PURCHASE_CONTRACT/);
  assert.match(supplierCreateDialog, /SUPPLIER_INVOICE/);
  assert.match(supplierCreateDialog, /上传供应商签章采购合同 PDF/);
  assert.match(supplierCreateDialog, /上传供应商开具的增值税专用发票 PDF/);
  assert.match(supplierCreateDialog, /role="checkbox"/);
  assert.match(supplierCreateDialog, /aria-checked=\{requiredTypes\.includes\(item\.value\)\}/);
  assert.match(supplierCreateDialog, /supplierDocumentRequestTypeCardSelected/);
  assert.doesNotMatch(supplierCreateDialog, /type="checkbox"/);
  assert.match(supplierDocumentStyles, /\.supplierDocumentRequestTypeCard/);
  assert.match(supplierDocumentStyles, /\.supplierDocumentRequestTypeCard:hover/);
  assert.match(supplierDocumentStyles, /\.supplierDocumentRequestTypeCard:focus-visible/);
  assert.match(supplierDocumentStyles, /\.supplierDocumentRequestTypeCardSelected/);
  assert.match(supplierDocumentStyles, /\.supplierDocumentRequestTypeCheck/);
  assert.match(supplierCostCandidatesRoute, /listSupplierDocumentRequestCostCandidates/);
  assert.match(supplierRequestListRoute, /costId: String\(formData\.get\("costId"\) \|\| ""\)/);
  assert.match(supplierRequestListRoute, /SUPPLIER_DOCUMENT_REQUEST_BODY_LIMIT_BYTES/);
  assert.match(supplierRequestListRoute, /8 \* 1024 \* 1024/);
  assert.match(supplierRequestListRoute, /content-length/);
  assert.match(supplierRequestListRoute, /SUPPLIER_DOCUMENT_FORM_PARSE_FAILED/);
  assert.match(supplierRequestListRoute, /回传表格读取失败，请确认文件小于 4MB/);
  assert.match(supplierRequestListRoute, /DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_CODE/);
  assert.match(supplierRequestListRoute, /message: \(error as \{ message\?: string \}\)\?\.message \|\| DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_MESSAGE/);
  assert.match(service, /export async function listSupplierDocumentRequestCostCandidates/);
  assert.match(service, /supplierDocumentRequestFactoryCostWhere/);
  assert.match(service, /costType: \{ in: FACTORY_SUPPLIER_COST_TYPES \}/);
  assert.match(service, /sourceType: \{ notIn: LOGISTICS_GENERATED_COST_SOURCE_TYPES \}/);
  assert.match(service, /allowFactoryDocumentUpload: true/);
  assert.match(service, /loadFactorySupplierReturnCostForRequest\(input\)/);
  assert.match(service, /TEMPLATE_FILE_REQUIRED/);
  assert.match(service, /请上传回传表格 Excel。/);
  assert.match(service, /safeSelectedProductSupplierPaymentVoucherAttachment/);
  assert.match(service, /付款凭证附件准备失败，已跳过水单附件/);
  assert.match(service, /supplierDocumentRequestOccupiedCostSet/);
  assert.match(service, /legacyWithoutCostOnly: true/);
  assert.match(service, /activeSupplierDocumentRequestPairSet/);
  assert.match(service, /DUPLICATE_SUPPLIER_DOCUMENT_REQUEST/);
  assert.match(service, /该工厂成本已存在资料回传任务，请在原任务中查看或替换资料。/);
  assert.match(service, /assertSupplierDocumentRequestCostAvailable\(factoryCost\)/);
  assert.match(service, /assertSupplierDocumentRequestCostAvailable\(factoryCost, tx\)/);
  assert.match(service, /Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(service, /P2002/);
  assert.match(service, /P2034/);
  assert.match(service, /请先在成本管理登记该订单的工厂供应商成本，再创建资料回传任务。/);
  assert.match(supplierRequestTemplateRoute, /\\\.\(xls\|xlsx\)\$/);
  assert.match(service, /resendSupplierDocumentRequestNotice/);
  assert.match(taxModule, /documentMatchesFactoryCostSlot\(document, cost, sameSupplierFactoryCostCount\)/);
  assert.doesNotMatch(taxModule, /document\.costId === cost\.id \|\| Boolean\(cost\.supplierId && document\.supplierId === cost\.supplierId\)/);
});

test("tax refund factory document slots are bound by cost item", () => {
  assert.match(taxModule, /factoryDocumentTargetKey\(item\.costId, item\.documentType \|\| ""\)/);
  assert.match(taxModule, /function documentMatchesFactoryCostSlot/);
  assert.match(taxModule, /if \(document\.costId\) return document\.costId === cost\.id/);
  assert.match(taxModule, /Boolean\(cost\.supplierId && document\.supplierId === cost\.supplierId\)/);
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

test("admin can soft delete supplier document requests from the foreground list", () => {
  assert.match(supplierRequestRoute, /export async function DELETE/);
  assert.match(supplierRequestRoute, /deleteSupplierDocumentRequest\(request, actor, id\)/);
  assert.match(service, /export async function deleteSupplierDocumentRequest/);
  assert.match(service, /actor\?\.role !== "管理员"/);
  assert.match(service, /只有管理员可以删除资料回传任务/);
  assert.match(service, /supplierDocumentRequestOrderLocked\(row\.order\)/);
  assert.match(service, /已提交退税或已归档/);
  assert.match(service, /tx\.orderDocument\.updateMany/);
  assert.match(service, /tx\.supplierDocumentRequest\.update/);
  assert.match(service, /deletedAt: now/);
  assert.match(service, /deletedById/);
  assert.match(service, /status: "DELETED"/);
  assert.match(service, /softDeleteFileAssetBySource/);
  assert.match(service, /scheduleTaxRefundCompletenessRefresh\(row\.orderId, "资料回传任务删除后退税完整度刷新"\)/);
  assert.match(service, /syncCostInvoiceStatus\(costId\)/);
  assert.doesNotMatch(service, /资料回传合同样本文件删除/);
  assert.match(supplierModule, /task\.canDelete/);
  assert.match(supplierModule, /styles\.supplierDocumentDeleteButton/);
  assert.match(supplierModule, /删除资料回传任务/);
  assert.match(supplierModule, /确认删除资料回传任务 \$\{task\.purchaseOrderNo \|\| task\.orderNo \|\| "-"\}？此操作将删除该任务及已上传资料，删除后不可恢复。/);
  assert.match(supplierModule, /该任务已关联退税资料，删除后退税完整度将重新计算。/);
  assert.match(supplierModule, /资料回传任务已删除/);
  assert.match(supplierModule, /method: "DELETE"/);
  assert.match(supplierModule, /const nextTotal = Math\.max\(0, total - 1\)/);
  assert.match(supplierModule, /setRows\(\(current\) => current\.filter\(\(row\) => row\.id !== task\.id\)\)/);
  assert.match(supplierModule, /void loadRows\(nextPage, pageSize, submittedKeyword, \{ silent: true \}\)/);
  assert.match(supplierModule, /void onRefreshTodos\?\.\(\)/);
});

test("supplier document request list uses server-side pagination", () => {
  const supplierRequestListRoute = readFileSync("app/api/supplier-document-requests/route.ts", "utf8");
  assert.match(service, /const \{ page, pageSize \} = pageParams\(query, 10, 50\)/);
  assert.match(service, /prisma\.supplierDocumentRequest\.count\(\{ where \}\)/);
  assert.match(service, /skip: \(page - 1\) \* pageSize/);
  assert.match(service, /take: pageSize/);
  assert.match(service, /select: supplierDocumentRequestListSelect\(\)/);
  assert.match(service, /purchaseOrderNo: true/);
  assert.match(service, /purchaseOrderNo: row\.purchaseOrderNo \|\| ""/);
  assert.match(service, /purchaseOrderNo: \{ contains: keyword, mode: "insensitive" \}/);
  assert.match(service, /purchaseOrderNo: order\.orderNo \|\| order\.id/);
  assert.match(service, /supplierDocumentRequestUploadedCounts\(rows\)/);
  assert.match(service, /serializeSupplierDocumentRequestListItem\(row, actor, uploadedCounts\.get\(row\.id\) \|\| 0\)/);
  assert.doesNotMatch(service, /rowsWithOcr/);
  assert.doesNotMatch(service, /take: 100/);
  assert.match(supplierRequestListRoute, /requests: result\.rows/);
  assert.match(supplierRequestListRoute, /pagination: \{/);
  assert.doesNotMatch(supplierRequestListRoute, /summary: result\.summary/);
  assert.match(supplierRequestStatsRoute, /getSupplierDocumentRequestStats/);
  assert.match(supplierRequestStatsRoute, /return ok\(\{ stats \}\)/);
  assert.match(supplierModule, /new URLSearchParams\(\{ page: String\(nextPage\), pageSize: String\(nextPageSize\) \}\)/);
  assert.match(supplierModule, /loadStats\(""\)/);
  assert.match(supplierModule, /\/api\/supplier-document-requests\/stats/);
  assert.match(supplierModule, /const \[statsError, setStatsError\] = useState\(""\)/);
  assert.match(supplierModule, /setStatsError\(""\)/);
  assert.match(supplierModule, /资料回传统计加载失败，请点击刷新任务重试。/);
  assert.doesNotMatch(supplierModule, /setPendingCount\(0\)/);
  assert.doesNotMatch(supplierModule, /setStatsTotalCount\(0\)/);
  assert.match(supplierModule, /statsError \? "加载失败" : statsLoading \? "加载中\.\.\." : statsTotalCount/);
  assert.match(supplierModule, /total=\{total\}/);
  assert.match(supplierModule, /async function loadRows\(nextPage = page, nextPageSize = pageSize, nextKeyword = "", options: \{ silent\?: boolean \} = \{\}\)/);
  assert.match(supplierModule, /if \(!options\.silent\) \{[\s\S]*setLoading\(true\);[\s\S]*setError\(""\);[\s\S]*setLoadError\(""\);[\s\S]*\}/);
  assert.match(supplierModule, /const \[submittedKeyword, setSubmittedKeyword\] = useState\(""\)/);
  assert.match(supplierModule, /setSubmittedKeyword\(nextKeyword\)/);
  assert.match(supplierModule, /function requestMatchesSubmittedKeyword\(request: SupplierDocumentTask\)/);
  const requestMatcherSnippet = supplierModule.slice(
    supplierModule.indexOf("function requestMatchesSubmittedKeyword"),
    supplierModule.indexOf("function mergeRequestRow"),
  );
  assert.match(requestMatcherSnippet, /request\.purchaseOrderNo \|\| request\.orderNo/);
  assert.match(requestMatcherSnippet, /currentUser(?:\.role|Role) === "产品供应商" \? "" : request\.supplierName/);
  assert.doesNotMatch(requestMatcherSnippet, /factoryCostText|requiredDocumentLabels|requiredDocumentTypes|templateFileName|request\.status|request\.message/);
  assert.match(supplierModule, /const shouldShowCreatedRequest = result\.request\?\.id \? mergeRequestRow\(result\.request\) : false/);
  assert.doesNotMatch(supplierModule, /rows\.slice\(start, start \+ pageSize\)/);
});

test("supplier document list failure is not rendered as an empty task list", () => {
  assert.match(supplierModule, /const \[loadError, setLoadError\]/);
  assert.match(supplierModule, /setLoadError\(message\)/);
  assert.match(supplierModule, /读取失败：/);
  assert.match(supplierModule, /重试/);
  assert.match(supplierModule, /!\s*loadError \? \(/);
  assert.match(supplierModule, /\) : loadError \? \(\s*null\s*\)/);
  assert.match(supplierModule, /SupplierDocumentListSkeleton/);
  assert.match(supplierModule, /loadTaskDetail\(taskId/);
  assert.match(supplierModule, /detailLoading: true/);
  assert.match(supplierModule, /detailError: message/);
  assert.match(supplierRequestRoute, /export async function GET/);
  assert.match(supplierRequestRoute, /getSupplierDocumentRequestDetail\(id, actor\)/);
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
  assert.match(repairSupplierReturnDocumentsScript, /repairTaxRelations/);
  assert.match(repairSupplierReturnDocumentsScript, /REPAIR_TAX_RELATION_ORDER_NOS/);
  assert.match(repairTaxRelationService, /export async function repairTaxRelations/);
  assert.match(repairTaxRelationService, /documentType: \{ in: SUPPLIER_DOCUMENT_TYPES \}/);
  assert.match(repairTaxRelationService, /costType: \{ in: FACTORY_SUPPLIER_COST_TYPES \}/);
  assert.match(repairTaxRelationService, /data\.cost = \{ connect: \{ id: targetCost\.id \} \}/);
  assert.match(repairTaxRelationService, /requestData\.cost = \{ connect: \{ id: targetCost\.id \} \}/);
  assert.match(repairTaxRelationService, /supplierId missing/);
  assert.match(repairTaxRelationService, /purchaseOrderId mismatch/);
  assert.match(repairTaxRelationService, /uploadTaskId missing/);
  assert.match(repairTaxRelationService, /status filtered/);
  assert.match(repairTaxRelationService, /tax-relation-repaired/);
  assert.match(repairTaxRelationService, /refreshTaxRefundCompleteness/);
  assert.match(repairTaxRelationService, /syncCostInvoiceStatus/);
  assert.match(repairSupplierReturnDocumentsScript, /refreshedOrders/);
  assert.match(repairSupplierReturnDocumentsScript, /syncedCosts/);
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
  assert.doesNotMatch(supplierModule, /已上传资料槽|uploadedDocumentSlots/);
  assert.doesNotMatch(supplierModule, /uploadSlots\.flatMap/);
});

test("supplier document backend normalizes legacy document type aliases before matching", () => {
  assert.match(service, /function normalizeSupplierReturnDocumentType/);
  assert.match(service, /PURCHASE_CONTRACT/);
  assert.match(service, /VAT_INVOICE/);
  assert.match(service, /requiredTypes\.includes\(normalizeSupplierReturnDocumentType\(document\.documentType\)/);
  assert.match(service, /const documentType = normalizeSupplierReturnDocumentType\(nonEmpty\(input\.documentType\)\) as OrderDocumentType/);
});

test("supplier document upload only saves the file before foreground OCR", () => {
  assert.match(uploadService, /message: "上传成功"/);
  assert.doesNotMatch(uploadService, /let ocrWarning = ""/);
  assert.doesNotMatch(uploadService, /let ocrTaskId = ""/);
  assert.doesNotMatch(uploadService, /供应商回传资料上传成功但OCR任务创建失败/);
  assert.doesNotMatch(uploadService, /产品供应商回传资料OCR后台识别/);
  assert.doesNotMatch(uploadService, /createSupplierDocumentOcrTaskForUpload\(document\.id\)/);
  assert.doesNotMatch(uploadService, /runSupplierDocumentOcrTaskWithTimeout\(ocrTask\.id\)/);
});
