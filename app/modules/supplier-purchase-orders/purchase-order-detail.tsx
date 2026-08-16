import baseStyles from "./supplier-purchase-orders.module.css";
import detailStyles from "./supplier-purchase-order-detail.module.css";
import itemStyles from "./supplier-purchase-order-detail-items.module.css";
import { formatTolerancePercent } from "../delivery-quantity-variance";
import {
  dateInputValue,
  formatDate,
  formatPrice,
  productionStatusLabel,
  isValidSupplierUnitPrice,
  responseActionLabel,
  responseSummary,
  statusLabel,
} from "./presentation";
import type { SupplierPurchaseOrderDto, SupplierPurchaseOrderResponseAction } from "./types";
import { DeliveryQuantityVarianceCard } from "./delivery-quantity-variance-card";
import { ProductionProgressCard } from "./production-progress-card";
import { SupplierContainerLoadsCard } from "./supplier-container-loads-card";
import { SupplierProductionCompletionCard } from "./supplier-production-completion-card";
const styles = { ...baseStyles, ...detailStyles, ...itemStyles };
type Props = {
  canWrite: boolean;
  detail: SupplierPurchaseOrderDto;
  error: string;
  notice: string;
  responseAction: SupplierPurchaseOrderResponseAction;
  deliveryDate: string;
  remark: string;
  itemPrices: Record<string, string>;
  canSubmit: boolean;
  submitting: boolean;
  productionCompleting: boolean;
  onBack: () => void;
  onActionChange: (action: SupplierPurchaseOrderResponseAction) => void;
  onDeliveryDateChange: (value: string) => void;
  onRemarkChange: (value: string) => void;
  onItemPriceChange: (itemId: string, value: string) => void;
  onSubmit: () => void;
  onProductionProgressSaved: (saved: SupplierPurchaseOrderDto, message: string) => void;
  onConfirmProductionCompletion: () => void;
};

export function SupplierPurchaseOrderDetail({
  canWrite,
  detail,
  error,
  notice,
  responseAction,
  deliveryDate,
  remark,
  itemPrices,
  canSubmit,
  submitting,
  productionCompleting,
  onBack,
  onActionChange,
  onDeliveryDateChange,
  onRemarkChange,
  onItemPriceChange,
  onSubmit,
  onProductionProgressSaved,
  onConfirmProductionCompletion,
}: Props) {
  const followUp = detail.status === "ACCEPTED";
  const proposalPending = detail.status === "DELIVERY_PROPOSED";
  const rejected = detail.status === "REJECTED";
  const deliveryFrozen = detail.deliveryFrozen;
  const rejecting = detail.status === "DISPATCHED" && responseAction === "REJECTED";
  const effectiveDeliveryDate = detail.confirmedSupplierDeliveryDate || detail.supplierDeliveryDate || detail.requestedDeliveryDate;
  const currentDeliveryDate = dateInputValue(effectiveDeliveryDate);
  const requiredPriceCount = detail.items.filter((item) => item.priceRequired).length;

  return (
    <section className={styles.module}>
      <header className={styles.detailHeader}>
        <div>
          <p className={styles.eyebrow}>采购单详情</p>
          <h2>{detail.poNo}</h2>
          <p className={styles.subtitle}>核对订单、产品价格与交期；每次回复都会保留历史记录。</p>
        </div>
        <div className={styles.actions}>
          <span className={styles.status} data-status={detail.status}>{statusLabel(detail.status)}</span>
          <button className={styles.secondaryButton} type="button" disabled={submitting || productionCompleting} onClick={onBack}>返回列表</button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}><span>客户订单号</span><strong>{detail.customerOrderNo || "-"}</strong></div>
        <div className={styles.summaryCard}><span>下发时间</span><strong>{formatDate(detail.dispatchedAt, true)}</strong></div>
        <div className={styles.summaryCard}><span>采购币种</span><strong>{detail.purchaseCurrency || "-"}</strong></div>
        <div className={styles.summaryCard}><span>原要求交期</span><strong>{formatDate(detail.requestedDeliveryDate)}</strong></div>
        <div className={styles.summaryCard}><span>当前生效交期</span><strong>{formatDate(effectiveDeliveryDate)}</strong></div>
        <div className={styles.summaryCard}><span>付款条款</span><strong>{detail.paymentTerm || "-"}</strong></div>
        <div className={styles.summaryCard}><span>预付款要求</span><strong>{formatPrice(detail.prepaymentRequiredAmount, detail.purchaseCurrency)}</strong></div>
        <div className={styles.summaryCard}><span>已登记预付款</span><strong>{formatPrice(detail.paidPrepaymentAmount, detail.purchaseCurrency)}</strong></div>
        <div className={styles.summaryCard}><span>生产状态</span><strong>{productionStatusLabel(detail.productionStatus)}</strong></div>
        <div className={styles.summaryCard}><span>交付数量公差</span><strong>±{formatTolerancePercent(detail.deliveryQuantityToleranceRatio)}%（本单冻结）</strong></div>
        <div className={styles.summaryCard}><span>首次确认交期</span><strong>{formatDate(detail.initialSupplierDeliveryDate)}</strong></div>
        <div className={styles.summaryCard}><span>内部确认交期</span><strong>{formatDate(detail.confirmedSupplierDeliveryDate)}</strong></div>
        <div className={styles.summaryCard}><span>实际交付日期</span><strong>{formatDate(detail.actualDeliveryDate)}</strong></div>
        <div className={styles.summaryCard}><span>回复状态</span><strong>{statusLabel(detail.status)}</strong></div>
        <div className={styles.summaryCard}><span>回复时间</span><strong>{formatDate(detail.respondedAt, true)}</strong></div>
      </div>

      <ProductionProgressCard canWrite={canWrite} detail={detail} disabled={submitting || productionCompleting} onSaved={onProductionProgressSaved} />
      <DeliveryQuantityVarianceCard canWrite={canWrite} detail={detail} disabled={submitting || productionCompleting} onSaved={onProductionProgressSaved} />
      <SupplierProductionCompletionCard canWrite={canWrite} productionStatus={proposalPending ? "WAITING_SUPPLIER" : detail.productionStatus} productionCompletedAt={detail.productionCompletedAt} allCompleted={detail.productionProgress.allCompleted} quantityVariancePending={detail.deliveryQuantityVariances.some((entry) => entry.status === "PENDING")} busy={submitting || productionCompleting} onConfirm={onConfirmProductionCompletion} />
      <SupplierContainerLoadsCard canWrite={canWrite} detail={detail} disabled={submitting || productionCompleting} onSaved={onProductionProgressSaved} />

      <section className={styles.section}>
        <h3>采购备注</h3>
        <div className={styles.remarkBox}>{detail.purchaseRemark || "无"}</div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h3>产品与价格明细</h3>
            <p className={styles.responseHint}>价格来源会保留标记；缺失单价须在首次非拒绝回复前逐行补齐。</p>
          </div>
          {requiredPriceCount ? <span className={styles.priceCount}>{requiredPriceCount} 行待回填</span> : null}
        </div>
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.productTable}`}>
            <thead><tr><th style={{ width: "56px" }}>序号</th><th>产品描述</th><th style={{ width: "80px" }}>单位</th><th style={{ width: "110px" }}>数量</th><th style={{ width: "210px" }}>采购单价</th><th style={{ width: "150px" }}>金额</th><th>行备注</th></tr></thead>
            <tbody>
              {detail.items.map((item, index) => {
                const priceValue = itemPrices[item.id] ?? "";
                const priceInvalid = Boolean(priceValue.trim()) && !isValidSupplierUnitPrice(priceValue);
                return (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td className={styles.orderNumber}>{item.productDescription || "-"}</td>
                    <td>{item.unit || "-"}</td>
                    <td>{item.quantity}</td>
                    <td>
                      {item.priceRequired ? (
                        <div className={styles.priceEntry}>
                          <div className={styles.priceInputRow}>
                            {detail.purchaseCurrency ? <span className={styles.currencyPrefix}>{detail.purchaseCurrency}</span> : null}
                            <input
                              className={styles.priceInput}
                              inputMode="decimal"
                              maxLength={20}
                              value={priceValue}
                              disabled={!canWrite || rejecting || rejected || proposalPending}
                              aria-label={`第 ${index + 1} 行 ${item.productDescription || "产品"}采购单价`}
                              aria-invalid={priceInvalid}
                              placeholder="填写单价"
                              onChange={(event) => onItemPriceChange(item.id, event.target.value)}
                            />
                          </div>
                          <span className={priceInvalid ? styles.fieldWarning : styles.priceMeta}>
                            {rejecting || rejected
                              ? "拒绝时无需回填"
                              : priceInvalid
                                ? "最多 12 位整数、6 位小数"
                                : "首次接受或改期前必填"}
                          </span>
                        </div>
                      ) : (
                        <div className={styles.priceEntry}>
                          <strong className={styles.priceValue}>{formatPrice(item.unitPrice, detail.purchaseCurrency)}</strong>
                          <span className={styles.priceBadge} data-source={item.supplierFilledPrice ? "supplier" : "purchase"}>
                            {item.supplierFilledPrice ? "供应商回填" : "采购单价格"}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      <strong className={styles.priceValue}>{formatPrice(item.amount, detail.purchaseCurrency)}</strong>
                      {item.priceRequired ? <span className={styles.priceMeta}>提交后按数量计算</span> : null}
                    </td>
                    <td>{item.remark || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h3>交期与回复历史</h3>
            <p className={styles.responseHint}>原始要求和每次供应商回复均按顺序保留，不覆盖旧记录。</p>
          </div>
          <span className={styles.historyCount}>{detail.responseHistory.length} 次回复</span>
        </div>
        <ol className={styles.historyList}>
          <li className={styles.historyItem}>
            <span className={styles.historyMarker} data-kind="origin">下发</span>
            <div className={styles.historyBody}>
              <div className={styles.historyMeta}>
                <strong>采购下发</strong>
                <time>{formatDate(detail.dispatchedAt, true)}</time>
              </div>
              <div className={styles.historyDetails}>
                <span>原要求交期：<strong>{formatDate(detail.requestedDeliveryDate)}</strong></span>
                <span>付款条款：<strong>{detail.paymentTerm || "-"}</strong></span>
              </div>
            </div>
          </li>
          {detail.responseHistory.map((entry, index) => (
            <li className={styles.historyItem} key={`${entry.sequence}:${entry.respondedAt || index}`}>
              <span className={styles.historyMarker}>{entry.sequence}</span>
              <div className={styles.historyBody}>
                <div className={styles.historyMeta}>
                  <strong>第 {entry.sequence} 次回复 · {responseActionLabel(entry.action)}</strong>
                  <time>{formatDate(entry.respondedAt, true)}</time>
                </div>
                <div className={styles.historyDetails}>
                  <span>回复交期：<strong>{formatDate(entry.deliveryDate)}</strong></span>
                  <span>说明：<strong>{entry.remark || "无补充说明"}</strong></span>
                  {entry.internalDecision ? <span>内部决定：<strong>{entry.internalDecision === "ACCEPTED" ? "已接受" : "已拒绝"}</strong></span> : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {!canWrite ? null : rejected || proposalPending || deliveryFrozen ? (
        <section className={styles.terminalCard}>
          <div className={styles.responseHeader}>
            <div><h3>{deliveryFrozen ? "生产完成，交期已冻结" : rejected ? "采购单已拒绝" : "新交期等待内部确认"}</h3><p className={styles.responseHint}>{deliveryFrozen ? "完工后不能再次提出或修改交期；历史回复继续保留。" : rejected ? `${responseSummary(detail)}，本单不再接受新的门户回复。` : `${responseSummary(detail)}，内部处理完成后才可继续提交新的交期变更。`}</p></div>
            <span className={styles.status} data-status={detail.status}>{statusLabel(detail.status)}</span>
          </div>
        </section>
      ) : (
        <section className={styles.responseCard}>
          <div className={styles.responseHeader}>
            <div>
              <h3>{followUp ? "再次提出新交期" : "提交首次回复"}</h3>
              <p className={styles.responseHint}>
                {followUp ? "本次只能提出一个不同于当前交期的新日期，并填写调整说明。" : "可接受原交期、提出新交期或拒绝采购单。"}
              </p>
            </div>
          </div>
          <div className={styles.responseGrid}>
            {followUp ? (
              <div className={styles.followUpSummary}>
                <span>当前交期</span>
                <strong>{formatDate(effectiveDeliveryDate)}</strong>
                <p>已提交 {detail.supplierResponseSequence} 次回复。本次提交后将追加一条改期记录。</p>
              </div>
            ) : (
              <div className={styles.actionChoices} role="radiogroup" aria-label="采购单回复操作">
                {([
                  ["ACCEPTED", "接受并确认交期"],
                  ["DELIVERY_PROPOSED", "提出新交期"],
                  ["REJECTED", "拒绝采购单"],
                ] as Array<[SupplierPurchaseOrderResponseAction, string]>).map(([action, label]) => (
                  <label className={styles.choice} key={action}>
                    <input type="radio" name="purchaseOrderResponse" value={action} checked={responseAction === action} onChange={() => onActionChange(action)} />
                    {label}
                  </label>
                ))}
              </div>
            )}
            <div className={styles.responseFields}>
              {responseAction !== "REJECTED" ? (
                <label className={styles.responseField}>
                  {responseAction === "ACCEPTED" ? "确认交货日期" : followUp ? "新的建议交货日期" : "建议新交货日期"}
                  <input type="date" value={deliveryDate} onChange={(event) => onDeliveryDateChange(event.target.value)} required />
                  {responseAction === "DELIVERY_PROPOSED" ? (
                    <span className={deliveryDate && deliveryDate === currentDeliveryDate ? styles.fieldWarning : styles.responseHint}>
                      当前生效交期为 {formatDate(effectiveDeliveryDate)}；新交期必须与其不同。
                    </span>
                  ) : null}
                </label>
              ) : null}
              <label className={styles.responseField}>
                {responseAction === "ACCEPTED" ? "补充备注（选填）" : responseAction === "DELIVERY_PROPOSED" ? "新交期说明（必填）" : "拒绝原因（必填）"}
                <textarea maxLength={2000} value={remark} onChange={(event) => onRemarkChange(event.target.value)} placeholder={responseAction === "ACCEPTED" ? "如有包装、装运等补充事项可填写" : "请填写具体原因，方便采购人员跟进"} />
              </label>
              {requiredPriceCount ? (
                <div className={styles.priceRequirement} data-disabled={rejecting}>
                  {rejecting
                    ? "当前选择拒绝采购单，无需回填缺失价格。"
                    : `请先在上方产品表格补齐 ${requiredPriceCount} 行采购单价，才能提交首次非拒绝回复。`}
                </div>
              ) : null}
              <div className={styles.actions}>
                <span className={styles.responseHint}>本次提交会追加到回复历史，既有记录不会被覆盖。</span>
                <button className={styles.primaryButton} type="button" disabled={!canSubmit} onClick={onSubmit}>
                  {submitting ? "正在提交..." : followUp ? "提交新交期" : "确认并提交回复"}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
