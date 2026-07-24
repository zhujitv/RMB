import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readOrdersModuleSource,
  readOrdersServiceSource,
  readSharedOrderSerializationSource,
} from "./source-helpers.ts";
import {
  isRefreshableOrderConflict,
  loadLatestOrderAfterConflict,
} from "../app/modules/orders/order-conflict-refresh.ts";

const ordersModule = readOrdersModuleSource();
const ordersService = readOrdersServiceSource();
const ordersListService = readFileSync("lib/platform/orders-module-list.ts", "utf8");
const orderSearchService = readFileSync("lib/platform/order-receivable-search.ts", "utf8");
const ordersPaymentsService = readFileSync("lib/platform/orders-payments.ts", "utf8");
const orderSerialization = readSharedOrderSerializationSource();
const inputSchemas = readFileSync("lib/platform/input-schemas.ts", "utf8");
const prismaSchema = readFileSync("prisma/schema.prisma", "utf8");
const mastersAccess = readFileSync("lib/platform/masters-access.ts", "utf8");
const quickOrderFields = readFileSync("app/modules/orders/quick-order-fields.tsx", "utf8");
const quickOrderController = readFileSync("app/modules/orders/quick-order-panel-controller.ts", "utf8");
const quickOrderPanel = readFileSync("app/modules/orders/quick-order-panel.tsx", "utf8");
const orderConflictRefresh = readFileSync("app/modules/orders/order-conflict-refresh.ts", "utf8");
const orderEditActions = readFileSync("app/modules/orders/use-order-edit-actions.ts", "utf8");
const ordersModuleController = readFileSync("app/modules/OrdersModule.tsx", "utf8");
const orderModel = readFileSync("app/modules/orders/model.ts", "utf8");
const orderUtils = readFileSync("app/modules/orders/utils.ts", "utf8");
const orderDetailDrawer = readFileSync("app/modules/orders/detail-drawer.tsx", "utf8");
const orderModuleView = readFileSync("app/modules/orders/module-view.tsx", "utf8");
const orderTable = readFileSync("app/modules/orders/table.tsx", "utf8");
const orderTableStyles = readFileSync("app/styles/workspace-shell/table-pinning-columns.module.css", "utf8");
const workspaceShellStyles = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("orders page renders only the table list and not duplicate order cards", () => {
  assert.doesNotMatch(ordersModule, /OrderMobileCard/);
  assert.doesNotMatch(ordersModule, /mobileCardList/);
  assert.doesNotMatch(ordersModule, /mobileDataCard/);
  assert.doesNotMatch(ordersModule, /desktopOnly/);
  assert.match(ordersModule, /<th className=\{styles\.orderNoColumn\}>订单号<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.customerColumn\}>客户简称<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.blNoColumn\}>提单号<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.amountColumn\}>最终应收<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.amountColumn\}>已收<\/th>/);
  assert.match(ordersModule, /<th className=\{styles\.amountColumn\}>未收<\/th>/);
  assert.match(ordersModule, /<th>状态<\/th>/);
  assert.match(ordersModule, /<th>详情<\/th>/);
  assert.match(ordersModule, /应收汇总/);
  assert.match(ordersModule, /人民币实际应收/);
  assert.match(ordersModule, /CurrencyTotalsDisplay/);
  assert.match(ordersService, /summary: summarizeCurrencyTotals/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{order\.finalReceivableAmount\} amountCny=\{order\.finalReceivableAmountCny\}/);
  assert.match(ordersModule, /const receivedAmount = Number\(order\.summary\?\.arrivedPaymentsAmount \?\? order\.summary\?\.confirmedPaymentsAmount/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{receivedAmount\} amountCny=\{receivedCny\}/);
  assert.match(ordersModule, /<MoneyAmount currency=\{order\.currency\} amount=\{displayedBalanceAmount\} amountCny=\{displayedBalanceCny\}/);
  assert.doesNotMatch(ordersModule, /function moneyCell/);
  assert.match(ordersModule, /<PaginationBar total=\{total\} page=\{page\} totalPages=\{totalPages\} onPage=\{(?:gotoPage|actions\.onPage)\} \/>/);
});

test("orders list keeps all receivable columns inside the medium desktop width budget", () => {
  assert.match(orderModuleView, /<section className=\{`\$\{styles\.moduleCard\} \$\{styles\.ordersModuleCard\}`\}>/);
  assert.match(orderModuleView, /<table className=\{`\$\{styles\.dataTable\} \$\{styles\.ordersListTable\}`\}>/);
  assert.match(workspaceShellStyles, /\.ordersListTable \{ composes: ordersListTable from "\.\/styles\/workspace-shell\/tables-dashboard\.module\.css"; \}/);
  assert.match(workspaceShellStyles, /\.ordersModuleCard \{ composes: ordersModuleCard from "\.\/styles\/workspace-shell\/tables-dashboard\.module\.css"; \}/);

  const tableHead = orderModuleView.match(/<th className=\{styles\.orderNoColumn\}>订单号<\/th>[\s\S]*?<th>详情<\/th>/)?.[0] || "";
  for (const label of ["订单号", "客户简称", "业务主体", "提单号", "最终应收", "已收", "未收", "状态", "详情"]) {
    assert.match(tableHead, new RegExp(label));
  }

  assert.match(orderTable, /<td className=\{styles\.orderNoColumn\} title=\{order\.orderNo \|\| ""\}>/);
  assert.match(orderTable, /<td className=\{styles\.customerColumn\} title=\{customerLegalName\(order\)\}>/);
  assert.match(orderTable, /<td className=\{styles\.businessEntityColumn\} title=\{businessEntityFullName \|\| ""\}>/);
  assert.match(orderTable, /<td className=\{styles\.blNoColumn\} title=\{order\.blNo \|\| order\.billOfLadingNo \|\| ""\}>/);

  const mediumDesktopCss = orderTableStyles.match(/@media \(min-width: 861px\) and \(max-width: 1535px\) \{[\s\S]*?\n\}\n\n\.taxCompletenessTooltipAnchor/)?.[0] || "";
  assert.match(mediumDesktopCss, /\.ordersModuleCard \{[\s\S]*padding-right: 12px;[\s\S]*padding-left: 12px;/);
  assert.match(mediumDesktopCss, /\.ordersListTable \{[\s\S]*min-width: 936px;[\s\S]*table-layout: fixed;/);
  assert.match(mediumDesktopCss, /\.tablePinnedTwoCols \.ordersListTable th,[\s\S]*padding-right: 6px;[\s\S]*padding-left: 6px;/);
  assert.match(mediumDesktopCss, /\.ordersListTable th\.amountColumn,[\s\S]*width: 134px;[\s\S]*min-width: 134px;/);
  assert.match(mediumDesktopCss, /\.ordersListTable td\.amountColumn \{[\s\S]*overflow: visible;/);
  assert.match(mediumDesktopCss, /\.ordersListTable td\.amountColumn > div > div \{[\s\S]*font-size: 12px;/);
  assert.match(mediumDesktopCss, /\.ordersListTable td\.amountColumn > div > div \+ div \{[\s\S]*font-size: 11px;/);
  assert.match(mediumDesktopCss, /\.ordersListTable td\.orderNoColumn,[\s\S]*\.ordersListTable td\.blNoColumn,[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(mediumDesktopCss, /\.ordersListTable td:nth-child\(9\) > button \{[\s\S]*white-space: nowrap;/);
  assert.doesNotMatch(mediumDesktopCss, /\.dataTable th\.orderNoColumn|\.logisticsCompactTable|\.taxRefundTable|\.costTableWrap/);

  const declaredWidth = 108 + 82 + 88 + 120 + (134 * 3) + 76 + 60;
  assert.equal(declaredWidth, 936);
  assert.ok(declaredWidth <= 960);
});

test("orders api sorts receivable orders by created time", () => {
  assert.match(ordersListService, /orderBy: \[\{ createdAt: "desc" \}, \{ updatedAt: "desc" \}\]/);
  assert.match(ordersListService, /pageParams\(query, 20, 20\)/);
  assert.match(ordersListService, /include: includeOrderListRelations\(\)/);
  assert.match(ordersListService, /serializeOrderListRow\(scopeOrderForActor\(order, actor\)\)/);
  assert.match(ordersListService, /skip: \(page - 1\) \* pageSize/);
  assert.match(ordersListService, /take: pageSize/);
  assert.doesNotMatch(ordersListService, /actualShipmentDate: "desc"/);
  assert.doesNotMatch(ordersListService, /blDate: "desc"/);
  assert.doesNotMatch(ordersListService, /sortReceivableRowsByShipmentDate/);
  assert.doesNotMatch(ordersListService, /sortedRows\.slice\(start, start \+ pageSize\)/);
});

test("paginated orders use a DTO that does not expose unloaded detail relations", () => {
  assert.match(orderSerialization, /export function serializeOrderListRow/);
  assert.match(orderSerialization, /export type SerializedOrderListRowDto = ReturnType<typeof serializeOrderListRow>/);

  const listSerializerStart = orderSerialization.indexOf("export function serializeOrderListRow");
  const listSerializerEnd = orderSerialization.indexOf("export function serializeOrder(", listSerializerStart);
  const listSerializer = orderSerialization.slice(listSerializerStart, listSerializerEnd);
  assert.match(listSerializer, /summary: serializeOrderListSummary\(summary\)/);
  assert.doesNotMatch(listSerializer, /documentCompleteness/);
  assert.doesNotMatch(listSerializer, /taxRefundStatus/);
  assert.doesNotMatch(listSerializer, /domesticLogisticsInfo/);
  assert.doesNotMatch(listSerializer, /shippingDocumentNotification/);
  assert.doesNotMatch(listSerializer, /shippingDocumentManualDraft/);
  assert.doesNotMatch(listSerializer, /documents,/);
  assert.doesNotMatch(listSerializer, /costs,/);

  const listSummaryStart = orderSerialization.indexOf("function serializeOrderListSummary");
  const listSummaryEnd = orderSerialization.indexOf("export function serializeOrderListRow", listSummaryStart);
  const listSummary = orderSerialization.slice(listSummaryStart, listSummaryEnd);
  assert.doesNotMatch(listSummary, /totalCostCny|expectedGrossProfit|commissionFormula|taxLogistics/);
});

test("cost-entry receivable search does not expose customer identity", () => {
  assert.match(orderSearchService, /const isCostEntrySearch = canWrite\(actor, "costs"\) && scope === "OWN_COST"/);
  assert.match(orderSearchService, /OR: isCostEntrySearch[\s\S]*\{ orderNo: \{ contains: q, mode: "insensitive" \} \}[\s\S]*\{ blNo: \{ contains: q, mode: "insensitive" \} \}/);
  assert.match(orderSearchService, /customerName: ""/);
  assert.match(orderSearchService, /customerFullName: ""/);
  assert.match(orderSearchService, /customerShortName: ""/);
  const costSearchStart = orderSearchService.indexOf("OR: isCostEntrySearch");
  const costSearchBranch = orderSearchService.slice(
    costSearchStart,
    orderSearchService.indexOf("        : [", costSearchStart),
  );
  assert.doesNotMatch(costSearchBranch, /customerNameSnapshot|customer: \{ is: \{ name|shortName/);
});

test("ordinary receivable search uses the lightweight order list DTO", () => {
  assert.match(orderSearchService, /include: includeOrderListRelations\(\)/);
  assert.match(orderSearchService, /serializeOrderListRow\(scopeOrderForActor\(order, actor\)\)/);
  assert.match(orderSearchService, /\? serializeReceivableSearchOrder\(scopeOrderForActor\(order, actor\)\)[\s\S]*: serializeOrderListRow\(scopeOrderForActor\(order, actor\)\)/);
  assert.doesNotMatch(orderSearchService, /serializeOrder\(scopeOrderForActor\(order, actor\)\)/);
  assert.doesNotMatch(orderSearchService, /\bserializeOrder,/);
});

test("orders save path normalizes complex input fields", () => {
  assert.match(ordersService, /requireLimitedText\(inputData\.orderNo, "订单号", MAX_ORDER_NO_LENGTH\)/);
  assert.match(ordersService, /optionalLimitedText\(inputData\.blNo \|\| inputData\.billOfLadingNo, "提单号", MAX_BL_NO_LENGTH\)/);
  assert.match(ordersService, /normalizeInstallments\(inputData\.paymentInstallments, finalReceivableAmount, exchangeRate\)/);
  assert.match(ordersService, /normalizeReminderDaysInput\(inputData\.reminderDays \?\? 7\)/);
  assert.match(ordersService, /optionalLimitedText\(inputData\.remark, "备注", MAX_ORDER_REMARK_LENGTH\)/);
  assert.match(ordersService, /normalizeOrderLogisticsSupplierIds\(inputData\)/);
});

test("order amount writes serialize payment-based status synchronization and retry conflicts", () => {
  const transactionRunner = ordersService.match(/const ORDER_WRITE_TRANSACTION_MAX_ATTEMPTS[\s\S]*?export async function saveOrder/);
  assert.ok(transactionRunner, "order transaction runner should exist");
  assert.match(transactionRunner[0], /ORDER_WRITE_TRANSACTION_MAX_ATTEMPTS = 3/);
  assert.match(transactionRunner[0], /=== "P2034"/);
  assert.match(transactionRunner[0], /attempt <= ORDER_WRITE_TRANSACTION_MAX_ATTEMPTS/);
  assert.match(transactionRunner[0], /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(transactionRunner[0], /attempt === ORDER_WRITE_TRANSACTION_MAX_ATTEMPTS/);
  assert.match(transactionRunner[0], /codedError\("订单刚刚被其他操作更新，请刷新后重试。", 409, "ORDER_UPDATE_CONFLICT"\)/);

  const saveStart = ordersService.indexOf("export async function saveOrder");
  const saveEnd = ordersService.indexOf("\nasync function assertNoUnfinishedOrderDocuments", saveStart);
  const saveBlock = ordersService.slice(saveStart, saveEnd);
  assert.match(saveBlock, /runOrderWriteTransaction\(async \(tx\) => \{/);
  assert.match(saveBlock, /await tx\.receivableOrder\.findFirst\(\{ where: \{ id, deletedAt: null \}, include: includeOrderRelations\(\) \}\)/);
  assert.match(saveBlock, /assertCurrentOrderWritable\(current, id, actor, expectedUpdatedAt\)/);
  assert.match(saveBlock, /assertCustomerScope\(actor, customerId, tx\)/);
  assert.match(saveBlock, /validateDuplicateOrder\(orderNo, id, tx\)/);
  assert.match(saveBlock, /resolveSalespersonUserId\(inputData, actor, transactionCustomer, current, tx\)/);
  assert.match(saveBlock, /resolveBusinessEntityForOrderInput\(inputData, current, tx\)/);
  assert.match(saveBlock, /tx\.receivableOrder\.updateMany\(\{[\s\S]*?where: \{ id, deletedAt: null, updatedAt: current\.updatedAt \}/);
  assert.match(saveBlock, /updated\.count !== 1[\s\S]*?ORDER_UPDATE_CONFLICT/);
  assert.match(saveBlock, /await tx\.receivableOrder\.create\(\{ data: writeData, include: includeOrderRelations\(\) \}\)/);
  assert.match(saveBlock, /const syncedOrder = await syncOrderStatusInTransaction\(tx, saved\)/);
  assert.match(saveBlock, /maybeSyncOrderLogisticsSuppliersInTransaction\(tx, syncedOrder, inputData, actor\)/);
  assert.match(saveBlock, /await writeAudit\([\s\S]*?current,[\s\S]*?orderWithSuppliers,[\s\S]*?tx,/);
  assert.match(saveBlock, /refreshTaxRefundCompleteness\(order\.id\)\.catch/);

  assert.match(saveBlock, /expectedOrderUpdatedAt\(inputData, before\)/);
  assert.match(saveBlock, /inputData\.expectedUpdatedAt \|\| inputData\.updatedAt/);
  assert.match(saveBlock, /current\.updatedAt\.getTime\(\) !== expectedUpdatedAt\.getTime\(\)/);
  assert.match(saveBlock, /ORDER_CURRENCY_LOCKED_BY_PAYMENTS/);
  assert.match(saveBlock, /normalizedCurrency\(current\.currency\) !== currency && hasCurrencyLockPayments\(current\.payments\)/);
  assert.match(ordersService, /ORDER_CURRENCY_LOCK_PAYMENT_STATUSES = \["待确认", "已到账"\]/);
  assert.match(saveBlock, /ORDER_CURRENCY_LOCK_PAYMENT_STATUSES\.includes\(String\(payment\.status \|\| ""\)\)/);
  assert.match(saveBlock, /withServerControlledCollectionStatus\(transactionData, current\)/);
  assert.match(saveBlock, /ORDER_COLLECTION_STATUSES\.includes\(requestedStatus\)/);

  const statusSyncStart = ordersService.indexOf("async function syncOrderStatusInTransaction");
  const statusSyncEnd = ordersService.indexOf("\nexport async function deleteOrder", statusSyncStart);
  const statusSyncBlock = ordersService.slice(statusSyncStart, statusSyncEnd);
  assert.match(statusSyncBlock, /summarizeOrder\(order\)/);
  assert.match(statusSyncBlock, /summary\.hasArrivedPaymentCurrencyMismatch/);
  assert.match(statusSyncBlock, /deriveOrderCollectionStatus\(\{/);
  assert.match(statusSyncBlock, /return tx\.receivableOrder\.update\(/);

  const publicSyncStart = ordersService.indexOf("export async function syncOrderStatus");
  const publicSyncBlock = ordersService.slice(publicSyncStart);
  assert.match(publicSyncBlock, /return runOrderWriteTransaction\(async \(tx\) => \{/);
  assert.match(publicSyncBlock, /tx\.receivableOrder\.findUnique/);
  assert.match(publicSyncBlock, /syncOrderStatusInTransaction\(tx, order\)/);
  assert.equal((ordersService.match(/runOrderWriteTransaction\(async \(tx\) => \{/g) || []).length, 3);
});

test("order edit form sends a version token and locks currency only for active payments", () => {
  assert.match(orderModel, /updatedAt\?: string/);
  assert.match(orderModel, /hasCurrencyLockPayments\?: boolean/);
  assert.match(orderModel, /expectedUpdatedAt: string/);
  assert.match(orderModel, /pendingPaymentsAmount\?: number/);
  assert.match(orderUtils, /expectedUpdatedAt: order\.updatedAt \|\| ""/);
  assert.match(orderSerialization, /hasCurrencyLockPayments: hasCurrencyLockPayments\(order\.payments\)/);
  assert.match(orderSerialization, /\["待确认", "已到账"\]\.includes\(String\(row\.status \|\| ""\)\)/);
  assert.match(quickOrderController, /const currencyLockedByPayments = Boolean\(initialOrder\?\.id/);
  assert.match(quickOrderController, /expectedUpdatedAt: normalizedForm\.expectedUpdatedAt \|\| initialOrder\?\.updatedAt \|\| undefined/);
  assert.match(quickOrderController, /if \(!currencyLockedByPayments && customerOption\.defaultCurrency\) await resolveExchangeRate/);
  assert.match(quickOrderController, /if \(currencyLockedByPayments\) \{[\s\S]*?币种已锁定/);
  assert.match(quickOrderPanel, /disabled=\{controller\.currencyLockedByPayments\}/);
  assert.match(quickOrderPanel, /已有待确认或已到账收款，币种已锁定/);
});

test("order edit conflict refreshes the list while preserving the attempted draft", async () => {
  const requestedPaths: string[] = [];
  const latestOrder = {
    id: "order/id 1",
    orderNo: "LATEST-ORDER",
    updatedAt: "2026-07-21T09:00:00.000Z",
    currency: "USD",
    hasCurrencyLockPayments: true,
  };
  const result = await loadLatestOrderAfterConflict(
    { status: 409, code: "HTTP_409", message: "订单刚刚被其他操作更新，请刷新后重试。" },
    latestOrder.id,
    async (path) => {
      requestedPaths.push(path);
      return { order: latestOrder };
    },
  );

  assert.deepEqual(result, latestOrder);
  assert.deepEqual(requestedPaths, ["/api/orders/order%2Fid%201"]);
  assert.equal(isRefreshableOrderConflict({ status: 409, message: "订单号已存在，不能重复提交" }), false);
  assert.match(orderConflictRefresh, /result\.order \|\| result\.data/);
  assert.match(quickOrderController, /loadLatestOrderAfterConflict\([\s\S]*?onConflictRefreshed\(latestOrder\)/);
  assert.doesNotMatch(quickOrderController, /if \(latestOrder\) \{\s*loadOrderSnapshot\(latestOrder\)/);
  assert.match(quickOrderController, /\[initialOrder, initialOrder\?\.updatedAt, loadOrderSnapshot\]/);
  assert.match(quickOrderController, /本次未保存内容已保留/);
  assert.match(orderEditActions, /function handleOrderConflictRefreshed\(order: OrderRow\)[\s\S]*?mergeOrderRow\(order, \{ shouldShow, preserveEditDraft: true \}\)/);
  assert.match(orderEditActions, /if \(!options\.preserveEditDraft\) \{\s*setEditOrder/);
  assert.match(ordersModuleController, /onOrderConflictRefreshed=\{handleOrderConflictRefreshed\}/);
});

test("receivable order UI does not expose commission rate editing or display", () => {
  assert.doesNotMatch(quickOrderFields, /提成比例|salespersonCommissionRate|commissionRate/);
  assert.doesNotMatch(orderDetailDrawer, /提成比例|salespersonCommissionRate|commissionRate/);
  assert.doesNotMatch(quickOrderController, /salespersonCommissionRate: form\.salespersonCommissionRate|commissionRate: form\.commissionRate|customerOption\.commissionRate/);
  assert.doesNotMatch(inputSchemas, /salespersonCommissionRate: \{ label: "提成比例"|commissionRate: \{ label: "提成比例"/);
  assert.match(ordersService, /function resolveSalespersonCommissionRate\(\s*customer: \{ commissionStatus\?: string \| null; commissionRate\?: unknown \} \| null \| undefined,\s*\) \{\s*return Math\.max\(0, Math\.round\(Number\(customer\?\.commissionStatus === "停用" \? 0 : customer\?\.commissionRate \|\| 0\) \* 100\) \/ 100\);\s*\}/);
  assert.doesNotMatch(ordersService, /inputHasOwn\(inputData, "salespersonCommissionRate"\)|inputData\.salespersonCommissionRate|inputData\.commissionRate/);
});

test("orders module keeps legacy order service exports after split", () => {
  assert.match(ordersService, /export \{ searchReceivableOrders \} from "\.\/order-receivable-search"/);
  assert.match(ordersService, /export \{ repairMissingOrderSalespeople \} from "\.\/order-salesperson-repair"/);
  assert.match(ordersPaymentsService, /export \* from "\.\/orders-module"/);
  assert.doesNotMatch(ordersPaymentsService, /export \* from "\.\/order-receivable-search"/);
  assert.doesNotMatch(ordersPaymentsService, /export \* from "\.\/order-salesperson-repair"/);
});

test("orders create form submits system exchange rate metadata", () => {
  assert.match(ordersModule, /exchangeRateDate: string;/);
  assert.match(ordersModule, /exchangeRateSource: string;/);
  assert.match(ordersModule, /exchangeRateType: string;/);
  assert.match(ordersModule, /exchangeRateDate: result\.rate\?\.rateDate \|\| ""/);
  assert.match(ordersModule, /exchangeRateSource: result\.rate\?\.source \|\| ""/);
  assert.match(ordersModule, /exchangeRateType: result\.rate\?\.rateType \|\| ""/);
  assert.match(ordersModule, /exchangeRateDate: normalizedForm\.exchangeRateDate \|\| undefined/);
  assert.match(ordersModule, /exchangeRateSource: normalizedForm\.exchangeRateSource \|\| undefined/);
  assert.match(ordersModule, /exchangeRateType: normalizedForm\.exchangeRateType \|\| undefined/);
  assert.match(ordersModule, /刷新官方汇率/);
  assert.match(ordersModule, /cacheOnly=1/);
  assert.match(ordersService, /!EXCHANGE_RATE_SOURCES\.includes\(exchange\.exchangeRateSource\)/);
  assert.match(ordersService, /当前订单缺少官方汇率，请点击【刷新官方汇率】后再保存。/);
  assert.doesNotMatch(ordersModule, /exchangeRateSource: "手动"/);
});

test("order logistics supplier default is only a per-order fallback", () => {
  assert.match(quickOrderController, /function isExwTradeTerm/);
  assert.match(quickOrderController, /isExwTradeTerm\(current\.tradeTerm\) \? current :/);
  assert.match(quickOrderController, /const selectedIds = current\.logisticsSupplierIds\.filter\(Boolean\)/);
  assert.match(quickOrderController, /if \(isExwTradeTerm\(current\.tradeTerm\)\) return \[\]/);
  assert.match(quickOrderController, /return defaultLogisticsSupplier \? \[defaultLogisticsSupplier\.id\] : \[\]/);
  assert.match(quickOrderController, /const logisticsSupplierIds = selectedLogisticsSupplierIds\(normalizedForm\)/);
  assert.match(quickOrderController, /if \(!isExwTradeTerm\(normalizedForm\.tradeTerm\) && !logisticsSupplierIds\.length\) return setMessage\("请选择物流供应商"\)/);
  assert.match(quickOrderController, /logisticsSupplierIds,/);
  assert.match(quickOrderFields, /disabled=\{!logisticsSuppliers\.length && !isExwOrder\}/);
  assert.doesNotMatch(quickOrderFields, /disabled=\{!allowMultipleLogisticsSuppliers\}/);
  assert.match(quickOrderFields, /物流供应商（选填）/);
  assert.match(quickOrderFields, /EXW 条款下可不指定物流供应商/);
  assert.match(quickOrderFields, /本订单单独切换；不会修改系统默认供应商/);
  assert.match(mastersAccess, /options: \{ allowEmpty\?: boolean; client\?: Prisma\.TransactionClient \} = \{\}/);
  assert.match(mastersAccess, /else if \(!options\.allowEmpty\)/);
  assert.doesNotMatch(mastersAccess, /ids = \[defaultSupplier\.id\];/);
  assert.match(ordersService, /function isExwOrderInput/);
  assert.match(ordersService, /syncOrderLogisticsSuppliers\(order\.id, logisticsSupplierIds, actor, \{ allowEmpty, client: tx \}\)/);
  assert.match(mastersAccess, /if \(options\.client\) \{[\s\S]*?await syncRelations\(options\.client\)/);
  assert.match(ordersService, /if \(!hasInput && !logisticsSettings\.allowMultipleOrderLogisticsSuppliers\)/);
  assert.match(ordersService, /if \(existingCount > 0\) return order/);
});

test("order detail edit switches from drawer to edit form without silent failure", () => {
  assert.match(ordersModule, /const editPanelRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(ordersModule, /function openEditOrder\(order: OrderRow \| null, options: \{ returnToDetail\?: boolean \} = \{\}\)/);
  assert.match(ordersModule, /setError\("权限不足，不能编辑"\)/);
  assert.match(ordersModule, /setError\("数据加载失败，不能编辑"\)/);
  assert.match(ordersModule, /setReturnDetailOrder\(options\.returnToDetail \? order : null\)/);
  assert.match(ordersModule, /setDetailOrder\(null\);[\s\S]*scrollToEditPanel\(\)/);
  assert.match(ordersModule, /onEdit=\{\(\) => (?:openEditOrder|actions\.onEditOrder)\(detailOrder, \{ returnToDetail: true \}\)\}/);
  assert.match(ordersModule, /function orderMatchesSubmittedFilters\(order: OrderRow\)/);
  assert.match(ordersModule, /order\.salespersonName/);
  assert.match(ordersModule, /function mergeOrderRow\(order: OrderRow, options: \{ shouldShow\?: boolean; preserveEditDraft\?: boolean \} = \{\}\)/);
  assert.match(ordersModule, /const shouldShow = orderMatchesSubmittedFilters\(order\)/);
  assert.match(ordersModule, /setDetailOrder\(order\?\.id \? \{ \.\.\.detailToRestore, \.\.\.order \} : detailToRestore\)/);
  assert.doesNotMatch(ordersModule, /nextRows\.find\(\(order\) => order\.id === savedOrder\.id\) \|\| detailToRestore/);
});

test("orders create form supports actual shipment date", () => {
  assert.match(prismaSchema, /actualShipmentDate\s+DateTime\?\s+@map\("actual_shipment_date"\) @db\.Date/);
  assert.match(inputSchemas, /actualShipmentDate: \{ label: "发货时间", kind: "date" \}/);
  assert.match(ordersService, /const actualShipmentDate = dateFromInput\(input(?:Data)?\.actualShipmentDate\)/);
  assert.match(ordersService, /actualShipmentDate,/);
  assert.match(orderSerialization, /actualShipmentDate: dateToInput\(order\.actualShipmentDate\)/);
  assert.match(ordersModule, /actualShipmentDate\?: string;/);
  assert.match(ordersModule, /actualShipmentDate: normalizedForm\.actualShipmentDate \|\| undefined/);
  assert.match(ordersModule, /发货时间/);
  assert.match(ordersModule, /<DetailField label="发货时间" value=\{order\.actualShipmentDate \|\| "-"\} \/>/);
  assert.doesNotMatch(ordersModule, /预计发货日期/);
  assert.doesNotMatch(ordersModule, /expectedShipmentDate: form\.expectedShipmentDate/);
  assert.doesNotMatch(ordersModule, /form\.expectedShipmentDate/);
  assert.doesNotMatch(ordersModule, /<DetailField label="预计发货"/);
  assert.doesNotMatch(inputSchemas, /expectedShipmentDate/);
  assert.doesNotMatch(inputSchemas, /预计发货日期/);
});

test("orders allow historical business dates for backfilled orders", () => {
  assert.match(quickOrderPanel, /actualShipmentDate[\s\S]*type="date"/);
  assert.match(quickOrderPanel, /blDate[\s\S]*type="date"/);
  assert.match(quickOrderPanel, /expectedArrivalDate[\s\S]*type="date"/);
  assert.match(quickOrderPanel, /expectedPaymentDate[\s\S]*type="date"/);
  assert.match(quickOrderPanel, /dueDate[\s\S]*type="date"/);
  assert.doesNotMatch(quickOrderPanel, /\bmin=/);
  assert.match(quickOrderPanel, /historicalDateNotice/);
  assert.match(quickOrderController, /当前为历史日期，请确认是否为补录订单。/);
  assert.doesNotMatch(quickOrderController, /不能早于今天|早于今天|不能创建过去|历史日期.*阻止/);
  assert.doesNotMatch(ordersService, /DUE_DATE_BEFORE_ORDER_DATE|到期日不能早于订单创建日期|不能早于今天|早于今天|不能创建过去/);
});
