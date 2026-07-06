import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCostRecordsMutationsSource, readCostRecordsQueriesSource, readCostsModuleSource, readLogisticsFeesModuleSource } from "./source-helpers.ts";
import test from "node:test";
import { readWorkspaceStylesSource } from "./source-helpers.ts";

const costsModule = readCostsModuleSource();
const costsMutation = readCostRecordsMutationsSource();
const costRoute = readFileSync("app/api/costs/[id]/route.ts", "utf8");
const costTypeRoute = readFileSync("app/api/costs/[id]/cost-type/route.ts", "utf8");
const costPaymentRoute = readFileSync("app/api/costs/[id]/payment/route.ts", "utf8");
const costPaymentVoucherRoute = readFileSync("app/api/costs/[id]/payment-voucher/route.ts", "utf8");
const costPaymentVoucherDownloadRoute = readFileSync("app/api/costs/[id]/payment-voucher/download/route.ts", "utf8");
const costsQueries = readCostRecordsQueriesSource();
const costsShared = readFileSync("lib/platform/cost-records-shared.ts", "utf8");
const businessDocuments = readFileSync("lib/platform/business-documents.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const paymentVoucherMigration = readFileSync("prisma/migrations/20260630093000_product_supplier_cost_payment_voucher/migration.sql", "utf8");
const uploadValidation = readFileSync("lib/platform/upload-validation.ts", "utf8");
const appUtils = readFileSync("app/utils.ts", "utf8");
const logisticsFeesModule = readLogisticsFeesModuleSource();
const workspaceStyles = readWorkspaceStylesSource();
const costsModuleWithoutDisableGuard = costsModule.replace(/const DISABLE_COMPONENT_RENDER = \[[\s\S]*?\] as const;\nvoid DISABLE_COMPONENT_RENDER;\n/, "");

test("costs page renders only the table list and not duplicate cost cards", () => {
  assert.doesNotMatch(costsModule, /CostMobileCard/);
  assert.doesNotMatch(costsModule, /CostOrderMobileCard/);
  assert.doesNotMatch(costsModule, /mobileCardList/);
  assert.doesNotMatch(costsModule, /desktopOnly/);
  assert.match(costsModule, /type CostView = "invoiceGroups" \| "details" \| "orders" \| "invoiceExceptions"/);
  assert.match(costsModule, /useState<CostView>\("invoiceGroups"\)/);
  assert.match(costsModule, /发票组 \/ Shipment 组/);
  assert.match(costsModule, /按订单 \/ Shipment 汇总/);
  assert.match(costsModule, /发票异常清单/);
  assert.doesNotMatch(costsModule, />成本明细<\/button>/);
  assert.match(costsModule, /<th className=\{styles\.orderNoColumn\}>订单号 \/ Shipment<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.customerColumn\}>客户简称<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.amountColumn\}>CNY 合计<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.amountColumn\}>USD 合计<\/th>/);
  assert.match(costsModule, /function CostOrderItemsTable/);
  assert.match(costsModule, /<th className=\{styles\.costInvoiceActionColumn\}>操作<\/th>/);
  assert.match(costsModule, /<PaginationBar total=\{total\} page=\{page\} totalPages=\{totalPages\} loading=\{loading\} onPage=\{(?:gotoPage|props\.onPage)\} \/>/);
});

test("product supplier cost payment vouchers are scoped away from logistics fees", () => {
  assert.match(schema, /paid\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /paidAt\s+DateTime\?\s+@map\("paid_at"\)/);
  assert.match(schema, /paymentVoucherStorageKey\s+String\?\s+@map\("payment_voucher_storage_key"\)/);
  assert.match(paymentVoucherMigration, /"cost_type" IN \('工厂货款', '原材料货款', '采购货款', '产品货款'\)/);
  assert.match(paymentVoucherMigration, /"source_type" <> 'LOGISTICS_EXPENSE'/);
  assert.match(costsMutation, /function assertCanManageProductSupplierPayment/);
  assert.match(costsMutation, /actor\.role === "管理员" \|\| actor\.role === "财务"/);
  assert.match(costsMutation, /export async function updateProductSupplierCostPayment[\s\S]*assertWrite\(actor, "costs"\)/);
  assert.match(costsMutation, /export async function uploadProductSupplierCostPaymentVoucher[\s\S]*assertWrite\(actor, "costs"\)/);
  assert.match(costsMutation, /function isProductSupplierPaymentCost/);
  assert.match(costsMutation, /cost\.sourceType === "LOGISTICS_EXPENSE" \|\| isLogisticsCostType/);
  assert.match(costsMutation, /export async function updateProductSupplierCostPayment/);
  assert.match(costsMutation, /export async function uploadProductSupplierCostPaymentVoucher/);
  assert.match(costsMutation, /productPaymentCost && !canManageProductPayment/);
  assert.match(costPaymentRoute, /updateProductSupplierCostPayment\(request, actor, id/);
  assert.match(costPaymentVoucherRoute, /uploadProductSupplierCostPaymentVoucher\(request, actor, id/);
  assert.match(costPaymentVoucherDownloadRoute, /getProductSupplierCostPaymentVoucher\(request, actor, id\)/);
  assert.match(costPaymentVoucherDownloadRoute, /export async function HEAD/);
  assert.match(costPaymentVoucherDownloadRoute, /searchParams\.get\("download"\) === "1" \? "attachment" : "inline"/);
  assert.match(costPaymentVoucherDownloadRoute, /managedFileStreamHeaders/);
  assert.match(uploadValidation, /readValidatedPaymentVoucherUploadFile/);
  assert.match(uploadValidation, /image\/jpeg/);
  assert.match(appUtils, /PAYMENT_VOUCHER_UPLOAD_ACCEPT/);
  assert.match(costsModule, /function ProductSupplierPaymentPanel/);
  assert.match(costsModule, /function PaymentVoucherPreviewModal/);
  assert.match(costsModule, /FilePreviewModal/);
  assert.match(costsModule, /fileKind="payment-voucher"/);
  assert.match(costsModule, /downloadLabel="下载凭证"/);
  assert.match(costsModule, /\/api\/files\/payment-voucher\/\$\{encodeURIComponent\(cost\.id\)\}\/download/);
  assert.doesNotMatch(costsModule, /target="_blank"[^>]*>\{voucherLabel\}/);
  assert.match(costsModule, /function isProductSupplierPaymentEnabled/);
  assert.match(costsModule, /isFactoryCost\(cost\) && !isLogisticsGeneratedCost\(cost\) && !isLogisticsInvoiceCost\(cost\)/);
  assert.match(costsModule, /const canManageFactoryPayments = \["管理员", "财务"\]\.includes\(currentUser\.role\)/);
  assert.match(costsModule, /function isProductSupplierPaymentFormLocked/);
  assert.match(costsModule, /disabled=\{paymentLocked\}/);
  assert.match(costsModule, /validatePaymentVoucherUploadFile/);
  assert.doesNotMatch(logisticsFeesModule, /付款凭证|汇款水单|已付款开关|单次付款时间/);
});

test("cost registration preserves exchange snapshots and does not silently merge batch lines", () => {
  assert.match(costsModule, /exchangeRateDate\?: string;/);
  assert.match(costsModule, /exchangeRateSource\?: string;/);
  assert.match(costsModule, /exchangeRateType\?: string;/);
  assert.match(costsModule, /exchangeRateDate: result\.rate\?\.rateDate \|\| paymentDate \|\| ""/);
  assert.match(costsModule, /exchangeRateSource: result\.rate\?\.source \|\| "(?:系统)?"/);
  assert.match(costsModule, /exchangeRateType: result\.rate\?\.rateType \|\| "(?:即期)?"/);
  assert.match(costsModule, /exchangeRateDate: item\.exchangeRateDate \|\| undefined/);
  assert.match(costsModule, /exchangeRateSource: item\.exchangeRateSource \|\| undefined/);
  assert.match(costsModule, /exchangeRateType: item\.exchangeRateType \|\| undefined/);
  assert.match(costsShared, /currency: duplicateText\(data\.currency, "CNY"\) \|\| "CNY"/);
  assert.match(costsShared, /exchangeRate: data\.exchangeRate/);
  assert.match(costsShared, /paymentDate: duplicateDate\(data\.paymentDate\)/);
  assert.match(costsShared, /sourceType: duplicateText\(data\.sourceType, "MANUAL"\) \|\| "MANUAL"/);
  assert.match(costsShared, /remark: data\.remark \|\| null/);
  assert.match(costsMutation, /prisma\.\$transaction\(\(tx\) => Promise\.all/);
  assert.match(costsMutation, /const idempotencyCutoff = new Date\(\)/);
  assert.match(costsMutation, /rows\.map\(\(data\) => createCostIdempotently\(data, tx, \{/);
  assert.match(costsMutation, /attachDocuments: false/);
  assert.match(costsMutation, /createdBefore: idempotencyCutoff/);
  assert.match(costsMutation, /const createdCosts = results\.filter\(\(result\) => !result\.reused\)/);
  assert.doesNotMatch(costsMutation, /uniqueRows|seen\.has|duplicateCostFingerprint\(data\)/);
});

test("cost management groups logistics invoices by shipment before display", () => {
  assert.match(costsModule, /type CostInvoiceGroupRow = \{/);
  assert.match(costsModule, /onChangeView\("invoiceGroups"\)/);
  assert.match(costsModule, /CostInvoiceGroupTableHead/);
  assert.match(costsModule, /CostInvoiceGroupRows/);
  assert.match(costsModule, /CostInvoiceGroupDrawer/);
  assert.match(costsModule, /group\.costTypeSummary/);
  assert.match(costsModule, /currencyTotalAmount\(group\.currencyTotals, "CNY"\)/);
  assert.match(costsModule, /currencyTotalAmount\(group\.currencyTotals, "USD"\)/);
  assert.match(costsModule, /onOpenDocuments=\{\(\) => (?:void )?(?:openInvoiceGroupDocuments|props\.onOpenInvoiceGroupDocuments)\(group\)\}/);
  assert.match(costsQueries, /export async function listCostInvoiceGroups/);
  assert.match(costsQueries, /function costInvoiceGroupKey/);
  assert.match(costsQueries, /`logistics-bill:\$\{billId\}`/);
  assert.match(costsQueries, /generatedLogisticsExpense: \{[\s\S]*bill: true/);
  assert.match(costsQueries, /const fullWhere: Prisma\.OrderCostWhereInput\[\] = \[\]/);
  assert.match(costsQueries, /sourceType: "LOGISTICS_EXPENSE"[\s\S]*generatedLogisticsExpense: \{ is: \{ billId: \{ in: billIds \} \} \}/);
  assert.match(costsQueries, /serializeCostInvoiceGroup/);
  assert.match(costsQueries, /summarizeCurrencyTotals\(groupCosts\)/);
});

test("cost management lists are backend sorted by payment and invoice workflow priority", () => {
  const listCostsPageSnippet = costsQueries.slice(
    costsQueries.indexOf("export async function listCostsPage"),
    costsQueries.indexOf("export async function getCost"),
  );
  assert.match(costsQueries, /COST_WORKFLOW_SORT_WEIGHTS = \[0, 1, 2, 3, 4\] as const/);
  assert.match(costsQueries, /export function costPaymentInvoiceSortGroupWhere/);
  assert.match(costsQueries, /if \(weight === 4\) return \{ paymentStatus: "已取消" \}/);
  assert.match(costsQueries, /const paid = weight >= 2/);
  assert.match(costsQueries, /const invoiceReceived = weight === 1 \|\| weight === 3/);
  assert.match(costsQueries, /paymentStatus: \{ notIn: \["已支付", "已取消"\] \}/);
  assert.match(costsQueries, /if \(paymentStatus === "已取消"\) return 4/);
  assert.match(costsQueries, /if \(!paid && !received\) return 0/);
  assert.match(costsQueries, /if \(!paid && received\) return 1/);
  assert.match(costsQueries, /if \(paid && !received\) return 2/);
  assert.match(costsQueries, /export function costWorkflowSortCompare/);
  assert.match(costsQueries, /async function findSortedCostRows/);
  assert.match(costsQueries, /listCostsPage[\s\S]*findSortedCostRows\(where, invoicePairs, \(page - 1\) \* pageSize, pageSize\)/);
  assert.match(costsQueries, /async function findInvoiceGroupCandidateRows/);
  assert.match(costsQueries, /buildCostInvoiceGroups[\s\S]*findInvoiceGroupCandidateRows\(\s*where,\s*invoicePairs,\s*requiredGroupCount,\s*candidateTake,\s*\)/);
  assert.match(costsQueries, /seenGroupKeys\.size < requiredGroupCount/);
  assert.match(costsQueries, /async function findSortedCostOrderIds/);
  assert.match(costsQueries, /listCostOrderSummaries[\s\S]*findSortedCostOrderIds\(costWhere, where, invoicePairs, skip, pageSize\)/);
  assert.match(costsQueries, /\.sort\(costWorkflowSortCompare\)/);
  assert.doesNotMatch(listCostsPageSnippet, /orderBy: \[\{ updatedAt: "desc" \}, \{ createdAt: "desc" \}\]/);
});

test("cost invoice group main list hides long invoice and cost type columns", () => {
  const headStart = costsModule.indexOf("function CostInvoiceGroupTableHead");
  const rowStart = costsModule.indexOf("function CostInvoiceGroupRows");
  const nextStart = costsModule.indexOf("function CostOrderTableHead");
  const headSnippet = costsModule.slice(headStart, rowStart);
  const rowSnippet = costsModule.slice(rowStart, nextStart);
  const drawerSnippet = costsModule.slice(
    costsModule.indexOf("function CostInvoiceGroupDrawer"),
    costsModule.indexOf("function CostDocumentsDrawer"),
  );

  assert.doesNotMatch(headSnippet, /发票号 \/ 文件|包含费用类型/);
  assert.doesNotMatch(rowSnippet, /group\.invoiceNo|group\.costTypeSummary/);
  assert.match(drawerSnippet, /<DetailField label="发票号 \/ 文件" value=\{group\.invoiceNo \|\| "-"\} wide \/>/);
  assert.match(drawerSnippet, /<DetailField label="包含费用类型" value=\{group\.costTypeSummary \|\| "-"\} wide \/>/);
  assert.match(costsModule, /if \(costView === "invoiceGroups"\) return 8;/);
  assert.match(costsModule, /if \(costView === "invoiceExceptions"\) return 9;/);
});

test("cost management exposes paginated invoice exception groups", () => {
  assert.match(costsModule, /onChangeView\("invoiceExceptions"\)/);
  assert.match(costsModule, /nextView === "invoiceExceptions"[\s\S]*invoiceStatus: "未收到"/);
  assert.match(costsModule, /value=\{costView === "invoiceExceptions" \? "未收到" : filters\.invoiceStatus\}/);
  assert.match(costsModule, /view: nextView/);
  assert.match(costsModule, /CostInvoiceGroupTableHead/);
  assert.match(costsModule, /CostInvoiceGroupRows/);
  assert.match(costsModule, /invoiceExceptionLabel/);
  assert.match(costsModule, /资料维护/);
  assert.match(costsQueries, /export async function listCostInvoiceExceptions/);
  assert.match(costsQueries, /buildCostInvoiceGroups\(query, actor, \{ exceptionsOnly: true \}\)/);
  assert.match(costsQueries, /function invoiceExceptionType/);
  assert.match(costsQueries, /if \(invoiceStatus !== "未收到"\) return ""/);
  assert.match(costsQueries, /已付款未收票/);
  assert.match(costsQueries, /已确认未收票/);
  assert.match(costsQueries, /超期未收票/);
  assert.doesNotMatch(costsQueries, /已收票未付款/);
  assert.match(costsQueries, /group\.invoiceStatus === "未收到" && Boolean\(group\.invoiceExceptionType\)/);
  assert.match(costsQueries, /successfulSupplierInvoicePairs/);
  assert.match(costsQueries, /supplierInvoicePairWhere/);
  assert.match(costsQueries, /attachBusinessDocumentsToCosts/);
  assert.match(businessDocuments, /factoryDocumentRequestId\) return SUPPLIER_RETURN_DOCUMENT_SOURCE/);
  assert.match(businessDocuments, /document\.orderId !== cost\.orderId \|\| document\.supplierId !== cost\.supplierId/);
  assert.match(businessDocuments, /if \(document\.costId\) return document\.costId === cost\.id/);
  assert.match(businessDocuments, /allowLegacySupplierFallback/);
  assert.match(businessDocuments, /cost-document-missing-check/);
  assert.match(businessDocuments, /costItemId: cost\.id \|\| ""/);
});

test("cost management page is centered and constrained to readable table width", () => {
  assert.match(costsModule, /<div className=\{styles\.costPage\}>/);
  assert.match(costsModule, /<section className=\{`\$\{styles\.moduleCard\} \$\{styles\.costContent\}`\}>/);
  assert.match(costsModule, /styles\.costTableWrap/);
  assert.match(costsModule, /<th className=\{styles\.statusColumn\}>状态<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.operationColumn\}>详情<\/th>/);
  assert.match(workspaceStyles, /\.costPage \{[\s\S]*display: flex;[\s\S]*justify-content: center;/);
  assert.match(workspaceStyles, /\.costContent \{[\s\S]*max-width: 1280px;[\s\S]*padding: 16px 24px;/);
  assert.match(workspaceStyles, /\.costTableWrap \{[\s\S]*max-width: 100%;[\s\S]*overflow-x: auto;/);
  assert.match(workspaceStyles, /\.costTableWrap \.dataTable \{[\s\S]*width: 100%;[\s\S]*table-layout: fixed;/);
  assert.match(workspaceStyles, /\.costTableWrap \.dataTable th,[\s\S]*\.costTableWrap \.dataTable td \{[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis;/);
  assert.match(costsModule, /<th className=\{styles\.supplierColumn\}>供应商<\/th>/);
  assert.match(costsModule, /<td className=\{styles\.supplierColumn\} title=\{supplierName\}>\{supplierName\}<\/td>/);
  assert.match(costsModule, /<td className=\{styles\.supplierColumn\} title=\{costSupplierName\(cost\)\}>\{costSupplierName\(cost\)\}<\/td>/);
  assert.match(workspaceStyles, /\.costTableWrap \.dataTable th\.supplierColumn,[\s\S]*min-width: 220px;[\s\S]*text-overflow: ellipsis;/);
  assert.match(workspaceStyles, /\.costTableWrap\.tablePinnedTwoCols \.dataTable th\.customerColumn,[\s\S]*width: 120px;/);
  assert.match(workspaceStyles, /\.costTableWrap \.dataTable th\.amountColumn,[\s\S]*width: 120px;/);
  assert.match(workspaceStyles, /\.costTableWrap \.dataTable th\.statusColumn,[\s\S]*width: 112px;/);
  assert.match(workspaceStyles, /\.costTableWrap \.dataTable th\.operationColumn,[\s\S]*width: 80px;/);
});

test("cost detail tables always keep an invoice operation column", () => {
  assert.match(costsModule, /function CostInvoiceActions/);
  assert.match(costsModule, /const logisticsGenerated = isLogisticsGeneratedCost\(cost\)/);
  assert.match(costsModule, /invoiceReceived \? \(/);
  assert.match(costsModule, />查看发票<\/button>/);
  assert.match(costsModule, />替换<\/button>/);
  assert.match(costsModule, />上传发票<\/button>/);
  assert.match(costsModule, /<th className=\{styles\.costInvoiceActionColumn\}>操作<\/th>/);
  assert.match(costsModule, /<CostOrderItemsTable[\s\S]*costs=\{order\.costs \|\| \[\]\}[\s\S]*onOpenDocuments=\{onOpenDocuments\}[\s\S]*onDelete=\{onDelete\}/);
  assert.match(costsModule, /<CostInvoiceActions cost=\{cost\} onOpenDocuments=\{onOpenDocuments\} onOpenPaymentVoucher=\{onOpenPaymentVoucher\} \/>/);
  assert.match(costsModule, /<CostInvoiceActions cost=\{cost\} onOpenDocuments=\{\(\) => onOpenDocuments\(cost\.id\)\} onOpenPaymentVoucher=\{onOpenPaymentVoucher\} \/>/);
  assert.match(costsModule, /deletingId === cost\.id \? "删除中\.\.\." : "删除"/);
  assert.match(workspaceStyles, /\.costInvoiceActions \{[\s\S]*display: flex;[\s\S]*gap: 6px;/);
  assert.match(workspaceStyles, /\.dataTable th\.costInvoiceActionColumn,[\s\S]*width: 180px;/);
});

test("logistics generated costs are read-only in cost invoice management", () => {
  assert.match(costsModule, /function isLogisticsGeneratedCost\(cost: Pick<CostRow, "sourceType">\)/);
  assert.match(costsModule, /return cost\.sourceType === "LOGISTICS_EXPENSE"/);
  assert.match(costsModule, /logisticsGenerated \? \(/);
  assert.match(costsModule, />查看说明<\/button>/);
  assert.match(costsModule, /const canManageDocuments = canWriteDocuments && !logisticsGenerated/);
  assert.match(costsModule, /发票按物流费用模块的分组开票规则上传；成本管理仅同步查看/);
  assert.match(costsModule, /物流费用发票以发票分组为准：报关费、港杂费、海运费、拖车及其他费用合并发票。成本管理只展示同步结果。/);
  assert.match(costsModule, /canWriteDocuments=\{canManageDocuments\}/);
  assert.doesNotMatch(costsModule, /logisticsGenerated[\s\S]{0,240}>上传发票<\/button>/);
});

test("manual temporary freight forwarder costs remain manageable in costs module", () => {
  assert.match(costsModule, /客户指定临时货代或手工录入的物流成本，可在成本管理维护对应物流发票。/);
  assert.match(costsModule, /const canManageDocuments = canWriteDocuments && !logisticsGenerated/);
  assert.doesNotMatch(costsModule, /isLogisticsInvoiceCost\(cost\)[\s\S]{0,160}canManageDocuments = false/);
  assert.match(costsModule, /documentType=\{documentType\}[\s\S]*canWriteDocuments=\{canManageDocuments\}/);
});

test("cost document drawer supports audited admin cost type correction", () => {
  assert.match(logisticsFeesModule, /\[\.\.\.baseTypes, "港杂费"\]/);
  assert.match(costsModule, /const canManageCostType = \["管理员", "财务"\]\.includes\(currentUser\.role\)/);
  assert.match(costsModule, /canManageCostType=\{canManageCostType\}/);
  assert.match(costsModule, /onUpdateCostType=\{props\.onUpdateCostType\}/);
  assert.match(costsModule, /\/api\/costs\/\$\{encodeURIComponent\(cost\.id\)\}\/cost-type/);
  assert.match(costsModule, /placeholder="必填，例如：原费用误选，按发票改为港杂费"/);
  assert.match(costsModule, /disabled=\{costTypeSaving \|\| !selectedCostType \|\| selectedCostType === \(cost\.costType \|\| ""\) \|\| !costTypeReason\.trim\(\)\}/);
  assert.match(costTypeRoute, /updateCostType\(request, actor, id, body\)/);
  assert.match(costTypeRoute, /return ok\(\{ success: true, ok: true, \.\.\.result \}\)/);
  assert.match(costsMutation, /export async function updateCostType/);
  assert.match(costsMutation, /只有管理员或财务可以修改已登记成本类型/);
  assert.doesNotMatch(costsMutation, /export async function updateCostType[\s\S]{0,260}assertWrite\(actor, "costs"\)/);
  assert.match(costsMutation, /requireText\(body\.reason \|\| body\.changeReason, "修改原因"\)/);
  assert.match(costsMutation, /data:\s*\{[\s\S]*costType: nextCostType,[\s\S]*updatedById: currentActor\.id/);
  assert.match(costsMutation, /oldCostType: before\.costType/);
  assert.match(costsMutation, /newCostType: nextCostType/);
  assert.match(costsMutation, /scheduleTaxRefundCompletenessRefresh\(updated\.orderId, "成本类型修改后退税完整度刷新"\)/);
  assert.match(costsMutation, /invalidateWorkbenchTodosCache\(\)/);
  assert.doesNotMatch(costsMutation, /国外代理费[\s\S]{0,120}港杂费/);
});

test("cost payable summary module is explicitly disabled and no longer rendered", () => {
  assert.match(costsModule, /const DISABLE_COMPONENT_RENDER = \[/);
  assert.match(costsModule, /"OrderPayableSummary"/);
  assert.match(costsModule, /"RmbSummaryBlock"/);
  assert.match(costsModule, /"UsdSummaryBlock"/);
  assert.match(costsModule, /"ExchangeSummaryBlock"/);
  assert.doesNotMatch(costsModule, /订单应付汇总|RMB 区块|USD 区块|汇总区块|按当前筛选条件统计|折人民币统计|CurrencyTotalsDisplay/);
  assert.doesNotMatch(costsModuleWithoutDisableGuard, /OrderPayableSummary|RmbSummaryBlock|UsdSummaryBlock|ExchangeSummaryBlock/);
  assert.doesNotMatch(costsModule, /CostPayableSummaryBlocks|CostPayableCurrencyBlock|CostBreakdownTable|orderCostPayableSummary|costPayable/);
  assert.doesNotMatch(costsQueries, /summary: summarizeCurrencyTotals|summarizeCurrencyTotals\(summaryRows|summaryRows/);
  assert.doesNotMatch(costsQueries, /orderPayableSummary|summarizeOrderPayableSummary/);
  assert.match(costsShared, /currencyTotals/);
  assert.doesNotMatch(costsShared, /summarizeOrderPayableSummary|orderPayableSummaryFromTotals|PayableCurrencySummary/);
});

test("cost order summary separates factory logistics and other cost totals", () => {
  assert.match(costsShared, /export function costSummaryCategory/);
  assert.match(costsShared, /FACTORY_SUMMARY_COST_TYPES = \[\.\.\.FACTORY_SUPPLIER_COST_TYPES, "样品费"\]/);
  assert.match(costsShared, /LOGISTICS_SUMMARY_COST_TYPES = \[/);
  assert.match(costsShared, /hasInvalidFactoryCurrency/);
  assert.match(costsShared, /cost-summary-invalid-factory-currency/);
  assert.match(costsShared, /const summaryCosts = summaryDisplayCosts\(costs\)/);
  assert.match(costsShared, /const currencyTotals = summarizeCurrencyTotals\(summaryCosts\)/);
  assert.match(costsShared, /costConfirmProgress: costConfirmedProgress\(summaryCosts\)/);
  assert.match(costsShared, /costs: summaryCosts\.map\(safeSerializeCost\)/);
  assert.match(costsShared, /totalCostCny = Number\(\(factoryTotals\.totalCny \+ logisticsTotals\.totalCny \+ otherTotals\.totalCny\)\.toFixed\(2\)\)/);
  assert.match(costsShared, /costBreakdown:\s*\{[\s\S]*factory: factoryTotals[\s\S]*logistics: logisticsTotals[\s\S]*other: otherTotals/);
  assert.match(costsModule, /function CostOrderAmountCell/);
  assert.match(costsModule, /currencyTotalAmount\(order\.currencyTotals, currency, fallback\)/);
  assert.match(costsModule, /<CostOrderAmountCell order=\{order\} currency="CNY" fallback=\{order\.totalCostCny\} \/>/);
  assert.doesNotMatch(costsModule, /COST_BREAKDOWN_ROWS|Factory Cost|Logistics Cost|Other Cost|成本结构/);
  assert.doesNotMatch(costsModule, /label="港杂成本"/);
});

test("removed payable summary styles cannot reappear as hidden UI", () => {
  assert.doesNotMatch(workspaceStyles, /costPayableSummary|costPayableEquivalentBlock|costBreakdownTable|costAmountBreakdown|costBreakdownLabelText/);
});

test("cost order summary keeps cost items inside shipment detail drawer", () => {
  assert.match(costsModule, /void loadCosts\(1, nextFilters, archiveScope, "invoiceGroups"\)/);
  assert.match(costsShared, /costs: summaryCosts\.map\(safeSerializeCost\)/);
  assert.match(costsModule, /<CostOrderItemsTable[\s\S]*costs=\{order\.costs \|\| \[\]\}[\s\S]*deletingId=\{deletingId\}[\s\S]*onDelete=\{onDelete\}/);
  assert.match(costsModule, /<th className=\{styles\.costInvoiceActionColumn\}>操作<\/th>/);
  assert.match(costsModule, /<CostInvoiceActions cost=\{cost\} onOpenDocuments=\{\(\) => onOpenDocuments\(cost\.id\)\} onOpenPaymentVoucher=\{onOpenPaymentVoucher\} \/>/);
  assert.match(costsModule, /formatCurrencyAmount\(cost\.currency \|\| "CNY", cost\.amount \?\? cost\.amountCny \?\? 0\)/);
  assert.doesNotMatch(costsModule, /\{ \.\.\.emptyCostFilters, orderNo:/);
  assert.doesNotMatch(costsModule, /setCostView\("details"\)/);
});

test("cost order detail can delete a cost item without reloading the page list", () => {
  assert.match(costsModule, /确认删除这条成本明细吗？删除后将影响该订单成本合计和利润分析。/);
  assert.match(costsModule, /function shouldVoidCostOnDelete/);
  assert.match(costsModule, /function costDeleteActionLabel/);
  assert.match(costsModule, /shouldVoidCostOnDelete\(cost\) \? "作废成本" : "删除成本"/);
  assert.match(costsModule, /确认作废这条成本明细吗？作废后将从当前成本、利润和退税完整度中移除，但保留历史审计记录。/);
  assert.match(costsModule, /处理方式：作废，不做物理删除/);
  assert.match(costsModule, /type CostDeleteResponse = \{/);
  assert.match(costsModule, /orderSummary\?: CostOrderSummary \| null/);
  assert.match(costsModule, /function applyDeletedCost\(cost: CostRow, orderSummary\?: CostOrderSummary \| null\)/);
  assert.match(costsModule, /setRows\(\(current\) => current\.filter\(\(item\) => item\.id !== cost\.id\)\)/);
  assert.match(costsModule, /setOrderRows\(\(current\) => \{/);
  assert.match(costsModule, /setDetailOrderSummary\(\(current\) => \{/);
  assert.match(costsModule, /function recalculateOrderSummary\(order: CostOrderSummary, costs: CostRow\[\]\): CostOrderSummary/);
  assert.match(costsModule, /summarizeCurrencyTotals\(activeCosts\)/);
  assert.match(costsModule, /costConfirmProgress: \{/);
  assert.match(costsModule, /documentProgress: \{/);
  assert.doesNotMatch(costsModule, /await loadCosts\(page, submittedFilters, archiveScope, costView\);\s*setNotice\(result\.message \|\| \(result\.action === "voided"/);
});

test("cost delete backend enforces permissions, audit, and voids risky records", () => {
  assert.match(costRoute, /const result = await deleteCost\(request, actor, id\)/);
  assert.match(costRoute, /return ok\(\{ success: true, ok: true, \.\.\.result \}\)/);
  assert.match(costsMutation, /function assertCanDeleteCost/);
  assert.match(costsMutation, /actor\.role === "管理员"/);
  assert.match(costsMutation, /isCostEntryActor\(actor\)/);
  assert.match(costsMutation, /actor\.role === "业务员"/);
  assert.match(costsMutation, /普通业务员不可删除已确认成本/);
  assert.match(costsMutation, /function canPhysicallyDeleteCost/);
  assert.match(costsMutation, /sourceType !== "LOGISTICS_EXPENSE"/);
  assert.match(costsMutation, /paymentStatus: "已取消"/);
  assert.match(costsMutation, /action === "deleted" \? "删除成本明细" : "作废成本明细"/);
  assert.match(costsMutation, /deletedById: actor\.id/);
  assert.match(costsMutation, /deletedAt/);
  assert.match(costsMutation, /orderNo: cost\.order\.orderNo/);
  assert.match(costsMutation, /costType: cost\.costType/);
  assert.match(costsMutation, /supplier: cost\.supplierNameSnapshot/);
  assert.match(costsMutation, /amount: Number\(cost\.amount\)/);
  assert.match(costsMutation, /orderSummary: await costOrderSummaryForMutation\(before\.orderId, currentActor\)/);
  assert.match(costsMutation, /scheduleTaxRefundCompletenessRefresh\(before\.orderId\)/);
});

test("cost create and edit interactions use right side drawers instead of inline panels", () => {
  assert.match(costsModule, /type CostFormDrawerState = \{/);
  assert.match(costsModule, /function CostFormDrawer\(/);
  assert.match(costsModule, /<SideDetailDrawer[\s\S]*ariaLabel=\{editMode \? "编辑成本" : "登记成本"\}/);
  assert.match(costsModule, /<QuickCreateCostPanel[\s\S]*drawerMode/);
  assert.match(costsModule, /onClick=\{(?:openCreateCostDrawer|props\.onCreateCost)\}/);
  assert.match(costsModule, /onEdit=\{\(\) => (?:openEditCostDrawer|props\.onEditCost)\(detailCost, \{ returnToDetail: true \}\)\}/);
  assert.doesNotMatch(costsModule, /createOpen/);
  assert.doesNotMatch(costsModule, /editCost/);
  assert.doesNotMatch(costsModule, /收起登记/);
});

test("cost detail drawer is tabbed and edit refreshes the current row", () => {
  assert.match(costsModule, /import \{[^}]*UiTabs/);
  assert.match(costsModule, /label: "基本信息"/);
  assert.match(costsModule, /label: "付款信息"/);
  assert.match(costsModule, /label: "发票信息"/);
  assert.match(costsModule, /label: "操作记录"/);
  assert.match(costsModule, /mergeCostRows\(saved\)/);
  assert.match(costsModule, /const \[returnDetailCost, setReturnDetailCost\] = useState<CostRow \| null>\(null\)/);
  assert.match(costsModule, /setDetailCost\(detailToRestore \? \{ \.\.\.detailToRestore, \.\.\.\(restoredDetail \|\| \{\}\) \} : null\)/);
  assert.match(costsModule, /function costMatchesSubmittedFilters\(cost: CostRow\)/);
  assert.match(costsModule, /function costDateMatchesSubmittedRange\(cost: CostRow, filters: CostFilters\)/);
  assert.match(costsModule, /const dates = \[cost\.createdAt, cost\.updatedAt, cost\.paymentDate\]/);
  assert.match(costsModule, /function equivalentSubmittedCostTypes\(costType = ""\)/);
  assert.match(costsModule, /if \(costType === "拖车费"\) return \["拖车费", "国内物流费", "国内拖车费"\]/);
  assert.match(costsModule, /if \((?:effectiveFilters|filters)\.costType && !equivalentSubmittedCostTypes\((?:effectiveFilters|filters)\.costType\)\.includes\(cost\.costType \|\| ""\)\) return false/);
  assert.match(costsModule, /cost\.supplierType/);
  assert.match(costsModule, /(?:if \(!costDateMatchesSubmittedRange\(cost, (?:effectiveFilters|filters)\)\) return false|return costDateMatchesSubmittedRange\(cost, filters\))/);
  assert.match(costsModule, /function refreshCostAggregatesInBackground\(\)/);
  assert.match(costsModule, /void loadCosts\(page, submittedFilters, archiveScope, costView, \{ silent: true \}\)/);
  assert.doesNotMatch(costsModule, /await fetchCostDetail\(savedDrawer\.cost\.id\)/);
  assert.doesNotMatch(costsModule, /await loadCosts\(page, submittedFilters, archiveScope, costView\)/);
  assert.doesNotMatch(costsModule, /void loadCosts\(1, submittedFilters, archiveScope, costView\)/);
});
