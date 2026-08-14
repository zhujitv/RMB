import { formatCurrencyAmount, formatDate, formatDateTime } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import styles from "./sales-execution.module.css";
import actionStyles from "./purchase-order-actions.module.css";
import { PurchaseOrderExecutionPanel } from "./purchase-order-execution-panel";
import { factoryPurchaseOrderStatusLabel, statusTone } from "./status-values";
import { numeric, optionalNumeric, supplierName, type FactoryPurchaseOrder, type PurchaseOrderItem } from "./types";

function purchaseOrderNumber(order: FactoryPurchaseOrder) {
  return String(order.poNo || order.purchaseOrderNo || "待生成编号");
}

function orderSupplierName(order: FactoryPurchaseOrder) {
  return order.supplierNameSnapshot || supplierName(order.supplier);
}

function purchaseItemDescription(item: PurchaseOrderItem) {
  const visibleDescription = String(item.productDescription || "").trim();
  if (visibleDescription) return visibleDescription;
  const name = String(item.descriptionSnapshot || item.productNameSnapshot || "").trim();
  const specification = String(item.specificationSnapshot || "").trim();
  if (!specification || name.toLowerCase().includes(specification.toLowerCase())) return name || "-";
  return `${name} (${specification.replace(/^\(|\)$/g, "")})`;
}

function purchaseOrderTotal(order: FactoryPurchaseOrder) {
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

function statusClass(status: unknown) {
  const tone = statusTone(status);
  if (tone === "success") return shell.statusSuccess;
  if (tone === "warning") return shell.statusWarning;
  if (tone === "danger") return shell.statusDanger;
  return shell.statusMuted;
}

function responseHint(status: unknown) {
  switch (String(status || "DRAFT")) {
    case "DISPATCHED": return "已正式下发，正在等待工厂确认。";
    case "ACCEPTED": return "工厂已接受订单。";
    case "DELIVERY_PROPOSED": return "工厂已建议新的交货日期，请跟进确认。";
    case "REJECTED": return "工厂已拒绝订单，请及时重新安排。";
    case "VOIDED": return "该工厂采购单已作废。";
    default: return "尚未正式下发。";
  }
}

export function PurchaseOrderDraftList({
  orders,
  executionId = "",
  executionRevision = 1,
  shippingStarted = false,
  customerOrderNo = "",
  canRetryEmail = false,
  retryingPurchaseOrderId = "",
  onRetryEmail,
  canStartProduction = false,
  canRecordPayment = false,
  canAddAdjustment = false,
  onExecutionChanged,
}: {
  orders: FactoryPurchaseOrder[];
  executionId?: string;
  executionRevision?: number;
  shippingStarted?: boolean;
  customerOrderNo?: string;
  canRetryEmail?: boolean;
  retryingPurchaseOrderId?: string;
  onRetryEmail?: (purchaseOrderId: string) => void;
  canStartProduction?: boolean;
  canRecordPayment?: boolean;
  canAddAdjustment?: boolean;
  onExecutionChanged?: () => void | Promise<void>;
}) {
  if (!orders.length) return <div className={shell.emptyState}>尚未生成工厂采购单，请先完成工厂分配。</div>;
  return (
    <div className={styles.purchaseOrderList}>
      {orders.map((order) => {
        const currency = String(order.purchaseCurrency || order.currency || "CNY");
        const total = purchaseOrderTotal(order);
        const latestResponse = order.supplierResponseHistory?.at(-1);
        return (
          <article className={styles.purchaseOrderCard} key={order.id}>
            <div className={styles.purchaseOrderHeader}>
              <div className={styles.purchaseOrderTitle}>
                <strong>{orderSupplierName(order)}</strong>
                <div><span className={`${shell.statusPill} ${statusClass(order.status)}`}>{factoryPurchaseOrderStatusLabel(order.status)}</span></div>
                <small>采购单号：{purchaseOrderNumber(order)}</small>
                <small>客户订单号：{customerOrderNo || "-"}</small>
                <small>{responseHint(order.status)}</small>
                <small>要求交货日期：{formatDate(order.requestedDeliveryDate)}</small>
                <small>付款条款：{String(order.paymentTerm || "-")}</small>
                {order.dispatchedAt ? <small>下发时间：{formatDateTime(order.dispatchedAt)}{order.dispatchedBy?.name ? ` · ${order.dispatchedBy.name}` : ""}</small> : null}
                {order.confirmedSupplierDeliveryDate || order.supplierDeliveryDate ? <small>当前生效交期：{formatDate(order.confirmedSupplierDeliveryDate || order.supplierDeliveryDate)}</small> : null}
                {order.status === "DELIVERY_PROPOSED" ? <small>待确认新交期：{formatDate(order.supplierResponseHistory?.at(-1)?.deliveryDate)}</small> : null}
                {order.supplierResponseRemark ? <small>供应商回复：{order.supplierResponseRemark}</small> : null}
                {latestResponse?.supplierRespondedAt ? <small>工厂实际回复：{formatDateTime(latestResponse.supplierRespondedAt)}{latestResponse.supplierContact ? ` · ${latestResponse.supplierContact}` : ""}</small> : null}
                {order.respondedAt ? <small>系统登记：{formatDateTime(order.respondedAt)}{order.respondedBy?.name ? ` · ${order.respondedBy.name}` : ""}</small> : null}
                {order.dispatchEmailStatus === "FAILED" ? <small className={styles.balancePending}>门户邮件提醒失败：{order.dispatchEmailError || "请检查供应商邮箱"}</small> : null}
                {order.dispatchEmailStatus === "NO_RECIPIENT" ? <small>未配置供应商门户账号，本单按线下协同，可由内部登记工厂回复。</small> : null}
                {canRetryEmail && order.dispatchEmailStatus === "FAILED" ? (
                  <div><button className={actionStyles.emailRetryButton} type="button" disabled={Boolean(retryingPurchaseOrderId)} onClick={() => onRetryEmail?.(order.id)}>{retryingPurchaseOrderId === order.id ? "重试中..." : "重试门户邮件"}</button></div>
                ) : null}
              </div>
              <span className={total === null ? styles.balancePending : styles.purchaseOrderTotal}>{total === null ? "待供应商回填" : formatCurrencyAmount(currency, total)}</span>
            </div>
            <div className={styles.detailTableWrap}>
              <table className={styles.detailTable}>
                <thead><tr><th>#</th><th>产品描述</th><th>单位</th><th>采购数量</th><th>采购单价</th><th className={styles.amountCell}>采购金额</th><th>工厂备注</th></tr></thead>
                <tbody>
                  {(order.items || []).map((item, index) => {
                    const description = purchaseItemDescription(item);
                    const quantity = numeric(item.allocatedQuantity ?? item.quantity);
                    const supplierFilled = optionalNumeric(item.supplierConfirmedUnitPrice) !== null;
                    const unitPrice = optionalNumeric(item.effectivePurchaseUnitPrice ?? item.purchaseUnitPrice ?? item.unitPrice);
                    const amount = unitPrice === null ? null : optionalNumeric(item.effectiveAmount ?? item.amount) ?? quantity * unitPrice;
                    return (
                      <tr key={item.id || `${order.id}-${index}`}>
                        <td>{index + 1}</td>
                        <td>{description}</td>
                        <td>{item.unitSnapshot || "-"}</td>
                        <td>{quantity.toLocaleString("zh-CN")}</td>
                        <td className={unitPrice === null ? styles.balancePending : undefined}>{unitPrice === null ? "待供应商回填" : `${formatCurrencyAmount(currency, unitPrice)}${supplierFilled ? "（工厂回填）" : ""}`}</td>
                        <td className={`${styles.amountCell} ${amount === null ? styles.balancePending : ""}`}>{amount === null ? "待供应商回填" : formatCurrencyAmount(currency, amount)}</td>
                        <td>{item.remark || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {executionId && order.status !== "DRAFT" ? (
              <PurchaseOrderExecutionPanel
                executionId={executionId}
                executionRevision={executionRevision}
                shippingStarted={shippingStarted}
                order={order}
                canStartProduction={canStartProduction}
                canRecordPayment={canRecordPayment}
                canAddAdjustment={canAddAdjustment}
                onChanged={onExecutionChanged || (() => undefined)}
              />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
