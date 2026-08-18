"use client";

import { useState } from "react";
import { DetailField, SideDetailDrawer } from "../../components";
import { formatCurrencyAmount, formatDate, formatDateTime } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { ContainerLoadsPanel } from "./container-loads-panel";
import { PurchaseOrderDraftList } from "./purchase-order-draft-list";
import { salesExecutionShippingReadiness } from "./shipping-readiness";
import styles from "./sales-execution.module.css";
import { salesExecutionStatusLabel, supplierResponseSummary } from "./status-values";
import {
  businessEntityName,
  customerOrderNumber,
  executionCustomerName,
  numeric,
  optionalNumeric,
  salesExecutionTotal,
  salesItemDescription,
  type FactoryPurchaseOrder,
  type SalesExecutionItem,
  type SalesExecutionRow,
} from "./types";

function purchaseTotal(order: FactoryPurchaseOrder) {
  const explicitTotal = optionalNumeric(order.effectiveSubtotal ?? order.totalAmount ?? order.subtotal);
  if (explicitTotal !== null) return explicitTotal;
  const items = order.items || [];
  if (!items.length || items.some((item) => optionalNumeric(item.effectivePurchaseUnitPrice ?? item.purchaseUnitPrice ?? item.unitPrice) === null)) return null;
  return items.reduce((sum, item) => {
    const quantity = numeric(item.allocatedQuantity ?? item.quantity);
    const unitPrice = optionalNumeric(item.effectivePurchaseUnitPrice ?? item.purchaseUnitPrice ?? item.unitPrice) || 0;
    return sum + (optionalNumeric(item.effectiveAmount ?? item.amount) ?? quantity * unitPrice);
  }, 0);
}

function allocatedQuantity(item: SalesExecutionItem, orders: FactoryPurchaseOrder[]) {
  return orders.reduce((total, order) => total + (order.items || []).reduce((sum, orderItem) => {
    return String(orderItem.executionItemId || orderItem.salesExecutionItemId || "") === item.id
      ? sum + numeric(orderItem.allocatedQuantity ?? orderItem.quantity)
      : sum;
  }, 0), 0);
}

export function ExecutionDetailDrawer({
  execution,
  loading,
  error,
  canEdit,
  canDispatch,
  canVoid,
  canDelete,
  canRetryDispatchEmail,
  canStartProduction,
  canRecordFactoryPayment,
  canAddFactoryAdjustment,
  canEnterShipping,
  canOpenReceivableOrder,
  dispatching,
  shippingStarting,
  voiding,
  deleting,
  dispatchError,
  shippingError,
  voidError,
  deleteError,
  retryingPurchaseOrderId,
  dispatchEmailRetryError,
  onEdit,
  onDispatch,
  onEnterShipping,
  onVoid,
  onDelete,
  onOpenReceivableOrder,
  onRetryDispatchEmail,
  onFactoryExecutionChanged,
  onClose,
}: {
  execution: SalesExecutionRow;
  loading: boolean;
  error: string;
  canEdit: boolean;
  canDispatch: boolean;
  canVoid: boolean;
  canDelete: boolean;
  canRetryDispatchEmail: boolean;
  canStartProduction: boolean;
  canRecordFactoryPayment: boolean;
  canAddFactoryAdjustment: boolean;
  canEnterShipping: boolean;
  canOpenReceivableOrder: boolean;
  dispatching: boolean;
  shippingStarting: boolean;
  voiding: boolean;
  deleting: boolean;
  dispatchError: string;
  shippingError: string;
  voidError: string;
  deleteError: string;
  retryingPurchaseOrderId: string;
  dispatchEmailRetryError: string;
  onEdit: () => void;
  onDispatch: () => void;
  onEnterShipping: () => void;
  onVoid: () => void;
  onDelete: () => void;
  onOpenReceivableOrder: (orderNo: string) => void;
  onRetryDispatchEmail: (purchaseOrderId: string) => void;
  onFactoryExecutionChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [view, setView] = useState<"internal" | "factory">("internal");
  const items = execution.items || [];
  const orders = execution.purchaseOrders || [];
  const activeOrders = orders.filter((order) => order.status !== "VOIDED");
  const currency = execution.currency || "CNY";
  const salesTotal = salesExecutionTotal(execution);
  const sameCurrencyOrders = activeOrders.filter((order) => String(order.purchaseCurrency || order.currency || "CNY") === currency);
  const hasOtherCurrency = sameCurrencyOrders.length !== activeOrders.length;
  const purchaseTotals = activeOrders.map((order) => purchaseTotal(order));
  const purchaseCostComplete = activeOrders.length > 0 && purchaseTotals.every((total) => total !== null);
  const comparablePurchaseTotal = purchaseCostComplete
    ? sameCurrencyOrders.reduce((sum, order) => sum + (purchaseTotal(order) || 0), 0)
    : null;
  const purchaseCostText = !activeOrders.length
    ? "尚未生成"
    : !purchaseCostComplete
      ? "待供应商回填"
      : hasOtherCurrency
        ? "待汇率折算"
        : formatCurrencyAmount(currency, comparablePurchaseTotal || 0);
  const marginText = !purchaseCostComplete
    ? "成本待回填"
    : hasOtherCurrency
      ? "待汇率折算"
      : formatCurrencyAmount(currency, salesTotal - (comparablePurchaseTotal || 0));
  const versions = execution.versions || [];
  const shippingReadiness = salesExecutionShippingReadiness(execution);
  const linkedOrder = execution.receivableOrder;
  return (
    <SideDetailDrawer
      ariaLabel="销售执行详情"
      kicker="销售执行"
      title={customerOrderNumber(execution) || "未填写客户订单号"}
      subtitle={`V${execution.currentVersionNumber || 1} · ${execution.sourceType === "QUOTATION" ? "报价转入" : "直接创建"} · ${salesExecutionStatusLabel(execution.status, Boolean(linkedOrder || execution.shippingStartedAt), linkedOrder?.status)}`}
      onClose={onClose}
      actions={canEdit || canDispatch || canVoid || canDelete || canEnterShipping || (linkedOrder && canOpenReceivableOrder) ? <>
        {canEdit ? <button className={shell.secondaryButton} type="button" disabled={loading || dispatching || shippingStarting || voiding || deleting} onClick={onEdit}>编辑草稿</button> : null}
        {canDispatch ? <button className={shell.primaryButtonCompact} type="button" disabled={loading || dispatching || shippingStarting || voiding || deleting || !orders.length} title={!orders.length ? "请先完成工厂分配" : undefined} onClick={onDispatch}>{dispatching ? "下发中..." : "正式下发工厂"}</button> : null}
        {canEnterShipping && !execution.shippingStartedAt ? <button className={shell.primaryButtonCompact} type="button" disabled={loading || dispatching || shippingStarting || voiding || deleting} title={shippingReadiness.ready ? undefined : shippingReadiness.reason} onClick={onEnterShipping}>{shippingStarting ? "处理中..." : linkedOrder ? "确认装柜完成" : "进入发货并创建应收"}</button> : null}
        {canVoid ? <button className={shell.dangerButton} type="button" disabled={loading || dispatching || shippingStarting || voiding || deleting} onClick={onVoid}>{voiding ? "作废中..." : "作废销售执行"}</button> : null}
        {canDelete ? <button className={shell.dangerButton} type="button" disabled={loading || deleting} onClick={onDelete}>{deleting ? "删除中..." : "永久删除"}</button> : null}
        {linkedOrder && canOpenReceivableOrder ? <button className={shell.primaryButtonCompact} type="button" disabled={loading || shippingStarting || voiding || deleting} onClick={() => onOpenReceivableOrder(linkedOrder.orderNo)}>打开应收订单</button> : null}
      </> : null}
    >
      {loading ? <div className={shell.emptyState}>正在读取销售执行详情...</div> : null}
      {error ? <div className={shell.inlineError} role="alert">{error}</div> : null}
      {dispatchError ? <div className={shell.inlineError} role="alert">{dispatchError}</div> : null}
      {shippingError ? <div className={shell.inlineError} role="alert">{shippingError}</div> : null}
      {voidError ? <div className={shell.inlineError} role="alert">{voidError}</div> : null}
      {deleteError ? <div className={shell.inlineError} role="alert">{deleteError}</div> : null}
      {dispatchEmailRetryError ? <div className={shell.inlineError} role="alert">{dispatchEmailRetryError}</div> : null}
      {linkedOrder ? <div className={shell.infoStrip} role="status">{execution.shippingStartedAt ? "装柜已最终确认" : "应收订单已创建，柜号可在提柜后补充"} · 应收订单：{linkedOrder.orderNo}（{linkedOrder.status}）</div> : null}
      {!loading && !error ? (
        <>
          <div className={styles.viewTabs} aria-label="销售执行详情视图">
            <button className={`${styles.tabButton} ${view === "internal" ? styles.tabActive : ""}`} type="button" aria-pressed={view === "internal"} onClick={() => setView("internal")}>内部执行视图</button>
            <button className={`${styles.tabButton} ${view === "factory" ? styles.tabActive : ""}`} type="button" aria-pressed={view === "factory"} onClick={() => setView("factory")}>工厂采购单</button>
          </div>

          {view === "factory" ? (
            <section className={styles.detailSection}>
              <div className={styles.privacyNote}>此视图仅包含工厂采购所需资料，不显示客户名称、客户销售价或利润。</div>
              <ContainerLoadsPanel
                executionId={execution.id}
                executionRevision={Number(execution.revision || 1)}
                loads={execution.containerLoads || []}
                orders={orders}
                canManage={canStartProduction}
                shippingStarted={Boolean(execution.shippingStartedAt)}
                onChanged={onFactoryExecutionChanged}
              />
              <PurchaseOrderDraftList
                orders={orders}
                executionId={execution.id}
                executionRevision={Number(execution.revision || 1)}
                shippingStarted={Boolean(execution.shippingStartedAt)}
                customerOrderNo={execution.customerOrderNo}
                canRetryEmail={canRetryDispatchEmail}
                retryingPurchaseOrderId={retryingPurchaseOrderId}
                onRetryEmail={onRetryDispatchEmail}
                canStartProduction={canStartProduction}
                canRecordPayment={canRecordFactoryPayment}
                canAddAdjustment={canAddFactoryAdjustment}
                onExecutionChanged={onFactoryExecutionChanged}
              />
            </section>
          ) : (
            <>
              <div className={shell.detailGrid}>
                <DetailField label="客户" value={executionCustomerName(execution)} wide />
                <DetailField label="业务主体" value={businessEntityName(execution.businessEntity) !== "-" ? businessEntityName(execution.businessEntity) : execution.businessEntityNameSnapshot || "-"} />
                <DetailField label="业务员" value={execution.salesperson?.name || execution.salespersonName || "-"} />
                <DetailField label="销售币种" value={currency} />
                <DetailField label="贸易条款" value={execution.tradeTerm || "-"} />
                <DetailField label="付款条款" value={execution.paymentTerm || "-"} wide />
                <DetailField label="客户订单号" value={execution.customerOrderNo || "-"} />
                <DetailField label="客户要求交货日期" value={formatDate(execution.requestedDeliveryDate)} />
                <DetailField label="来源报价" value={execution.sourceQuotation?.quoteNo || execution.sourceQuotation?.quotationNo || "-"} />
                <DetailField label="更新时间" value={formatDateTime(execution.updatedAt)} />
                <DetailField label="内部备注" value={execution.remark || "-"} wide />
              </div>

              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}><span>客户销售总额</span><strong>{formatCurrencyAmount(currency, salesTotal)}</strong></div>
                <div className={styles.summaryCard}><span>采购成本</span><strong>{purchaseCostText}</strong></div>
                <div className={styles.summaryCard}><span>预估毛利</span><strong>{marginText}</strong></div>
                <div className={styles.summaryCard}><span>有效采购单</span><strong>{activeOrders.length} 张{orders.length > activeOrders.length ? ` · 作废 ${orders.length - activeOrders.length}` : ""}</strong></div>
                <div className={styles.summaryCard}><span>供应商响应</span><strong>{supplierResponseSummary(orders)}</strong></div>
              </div>

              <section className={styles.detailSection}>
                <div className={styles.sectionHeader}><div className={styles.sectionTitle}><h3>客户销售明细</h3><small>仅内部可见，客户销售价不会进入工厂采购草稿。</small></div></div>
                <div className={styles.detailTableWrap}>
                  <table className={styles.detailTable}>
                    <thead><tr><th>#</th><th>产品描述</th><th>单位</th><th>销售数量</th><th>单件/单套净重 (kg)</th><th>已分配</th><th>客户销售单价</th><th className={styles.amountCell}>销售金额</th></tr></thead>
                    <tbody>{items.map((item, index) => {
                      const quantity = numeric(item.quantity);
                      const unitPrice = numeric(item.salesUnitPrice ?? item.unitPrice);
                      const unitNetWeightKg = optionalNumeric(item.unitNetWeightKg);
                      return <tr key={item.id}><td>{index + 1}</td><td>{salesItemDescription(item) || "-"}</td><td>{item.unit || "-"}</td><td>{quantity.toLocaleString("zh-CN")}</td><td>{unitNetWeightKg === null ? "-" : unitNetWeightKg.toLocaleString("zh-CN")}</td><td>{allocatedQuantity(item, activeOrders).toLocaleString("zh-CN")}</td><td>{formatCurrencyAmount(currency, unitPrice)}</td><td className={styles.amountCell}>{formatCurrencyAmount(currency, item.salesAmount ?? item.amount ?? quantity * unitPrice)}</td></tr>;
                    })}</tbody>
                  </table>
                </div>
              </section>

              {versions.length ? (
                <section className={styles.detailSection}>
                  <div className={styles.sectionHeader}><div className={styles.sectionTitle}><h3>版本记录</h3><small>每次保存均保留版本快照。</small></div></div>
                  <div className={styles.viewTabs}>{versions.map((version) => <span className={styles.sourcePill} key={version.id || version.versionNumber}>V{version.versionNumber || 1} · {formatDateTime(version.createdAt)}</span>)}</div>
                </section>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </SideDetailDrawer>
  );
}
