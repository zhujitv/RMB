import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
const costsMutation = readFileSync("lib/platform/cost-records-mutations.ts", "utf8");
const costRoute = readFileSync("app/api/costs/[id]/route.ts", "utf8");
const costsQueries = readFileSync("lib/platform/cost-records-queries.ts", "utf8");
const costsShared = readFileSync("lib/platform/cost-records-shared.ts", "utf8");
const workspaceStyles = readFileSync("app/WorkspaceShell.module.css", "utf8");
const costsModuleWithoutDisableGuard = costsModule.replace(/const DISABLE_COMPONENT_RENDER = \[[\s\S]*?\] as const;\nvoid DISABLE_COMPONENT_RENDER;\n/, "");

test("costs page renders only the table list and not duplicate cost cards", () => {
  assert.doesNotMatch(costsModule, /CostMobileCard/);
  assert.doesNotMatch(costsModule, /CostOrderMobileCard/);
  assert.doesNotMatch(costsModule, /mobileCardList/);
  assert.doesNotMatch(costsModule, /desktopOnly/);
  assert.match(costsModule, /type CostView = "details" \| "orders" \| "invoiceExceptions"/);
  assert.match(costsModule, /useState<CostView>\("orders"\)/);
  assert.match(costsModule, /按订单 \/ Shipment 汇总/);
  assert.match(costsModule, /发票异常清单/);
  assert.doesNotMatch(costsModule, />成本明细<\/button>/);
  assert.match(costsModule, /<th className=\{styles\.orderNoColumn\}>订单号 \/ Shipment<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.customerColumn\}>客户简称<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.amountColumn\}>CNY 合计<\/th>/);
  assert.match(costsModule, /<th className=\{styles\.amountColumn\}>USD 合计<\/th>/);
  assert.match(costsModule, /function CostOrderItemsTable/);
  assert.match(costsModule, /<th className=\{styles\.costInvoiceActionColumn\}>操作<\/th>/);
  assert.match(costsModule, /<PaginationBar total=\{total\} page=\{page\} totalPages=\{totalPages\} loading=\{loading\} onPage=\{gotoPage\} \/>/);
});

test("cost management exposes paginated invoice exception list", () => {
  assert.match(costsModule, /changeCostView\("invoiceExceptions"\)/);
  assert.match(costsModule, /view: nextView/);
  assert.match(costsModule, /CostInvoiceExceptionTableHead/);
  assert.match(costsModule, /CostInvoiceExceptionRows/);
  assert.match(costsModule, /invoiceExceptionLabel/);
  assert.match(costsModule, /已付款未收票/);
  assert.match(costsModule, /已收票未付款/);
  assert.match(costsModule, /资料维护/);
  assert.match(costsQueries, /export async function listCostInvoiceExceptions/);
  assert.match(costsQueries, /function costInvoiceExceptionWhere/);
  assert.match(costsQueries, /paymentStatus: "已支付"[\s\S]*costEffectiveInvoiceMissingWhere/);
  assert.match(costsQueries, /paymentStatus: \{ in: \["待支付", "部分支付"\] \}[\s\S]*costEffectiveInvoiceReceivedWhere/);
  assert.match(costsQueries, /documents: \{ some: SUCCESS_SUPPLIER_INVOICE_FILTER \}/);
  assert.match(costsQueries, /documents: \{ none: SUCCESS_SUPPLIER_INVOICE_FILTER \}/);
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
  assert.match(workspaceStyles, /\.costTableWrap\.tablePinnedTwoCols \.dataTable th\.customerColumn,[\s\S]*width: 120px;/);
  assert.match(workspaceStyles, /\.costTableWrap \.dataTable th\.amountColumn,[\s\S]*width: 120px;/);
  assert.match(workspaceStyles, /\.costTableWrap \.dataTable th\.statusColumn,[\s\S]*width: 100px;/);
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
  assert.match(costsModule, /<CostInvoiceActions cost=\{cost\} onOpenDocuments=\{onOpenDocuments\} \/>/);
  assert.match(costsModule, /<CostInvoiceActions cost=\{cost\} onOpenDocuments=\{\(\) => onOpenDocuments\(cost\.id\)\} \/>/);
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
  assert.match(costsModule, /void loadCosts\(1, nextFilters, archiveScope, "orders"\)/);
  assert.match(costsShared, /costs: summaryCosts\.map\(safeSerializeCost\)/);
  assert.match(costsModule, /<CostOrderItemsTable[\s\S]*costs=\{order\.costs \|\| \[\]\}[\s\S]*deletingId=\{deletingId\}[\s\S]*onDelete=\{onDelete\}/);
  assert.match(costsModule, /<th className=\{styles\.costInvoiceActionColumn\}>操作<\/th>/);
  assert.match(costsModule, /<CostInvoiceActions cost=\{cost\} onOpenDocuments=\{\(\) => onOpenDocuments\(cost\.id\)\} \/>/);
  assert.match(costsModule, /formatCurrencyAmount\(cost\.currency \|\| "CNY", cost\.amount \?\? cost\.amountCny \?\? 0\)/);
  assert.doesNotMatch(costsModule, /\{ \.\.\.emptyCostFilters, orderNo:/);
  assert.doesNotMatch(costsModule, /setCostView\("details"\)/);
});

test("cost order detail can delete a cost item without reloading the page list", () => {
  assert.match(costsModule, /message: "确认删除这条成本明细吗？删除后将影响该订单成本合计和利润分析。"/);
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
  assert.match(costsMutation, /refreshTaxRefundCompleteness\(before\.orderId\)/);
});

test("cost create and edit interactions use right side drawers instead of inline panels", () => {
  assert.match(costsModule, /type CostFormDrawerState = \{/);
  assert.match(costsModule, /function CostFormDrawer\(/);
  assert.match(costsModule, /<SideDetailDrawer[\s\S]*ariaLabel=\{editMode \? "编辑成本" : "登记成本"\}/);
  assert.match(costsModule, /<QuickCreateCostPanel[\s\S]*drawerMode/);
  assert.match(costsModule, /onClick=\{openCreateCostDrawer\}/);
  assert.match(costsModule, /onEdit=\{\(\) => openEditCostDrawer\(detailCost\)\}/);
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
  assert.match(costsModule, /await fetchCostDetail\(savedDrawer\.cost\.id\)/);
  assert.match(costsModule, /await loadCosts\(page, submittedFilters, archiveScope, costView\)/);
  assert.doesNotMatch(costsModule, /void loadCosts\(1, submittedFilters, archiveScope, costView\)/);
});
