import styles from "../../WorkspaceShell.module.css";
import {
  COST_CONFIRMATION_OPTIONS,
  COST_FILTER_TYPE_LABELS,
  COST_FILTER_TYPES,
  COST_INVOICE_STATUSES,
  COST_PAYMENT_STATUSES,
  type CostFilters,
  type CostView,
} from "./model";

export function CostFilterPanel({
  costView,
  filters,
  archiveScope,
  loading,
  onChangeView,
  onChangeArchiveScope,
  onSetFilter,
  onSubmit,
  onReset,
}: {
  costView: CostView;
  filters: CostFilters;
  archiveScope: string;
  loading: boolean;
  onChangeView: (view: CostView) => void;
  onChangeArchiveScope: (scope: string) => void;
  onSetFilter: <K extends keyof CostFilters>(key: K, value: CostFilters[K]) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <div className={styles.listToolbar}>
        <button className={costView === "invoiceGroups" ? styles.primaryButtonCompact : styles.secondaryButton} type="button" disabled={loading} onClick={() => onChangeView("invoiceGroups")}>
          发票组 / Shipment 组
        </button>
        <button className={costView === "orders" ? styles.primaryButtonCompact : styles.secondaryButton} type="button" disabled={loading} onClick={() => onChangeView("orders")}>
          按订单 / Shipment 汇总
        </button>
        <button className={costView === "invoiceExceptions" ? styles.primaryButtonCompact : styles.secondaryButton} type="button" disabled={loading} onClick={() => onChangeView("invoiceExceptions")}>
          发票异常清单
        </button>
      </div>

      <div className={styles.costFilterPanel}>
        <div className={styles.costFilterSearchRow}>
          <label>
            关键词
            <input
              value={filters.keyword}
              onChange={(event) => onSetFilter("keyword", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit();
              }}
              placeholder="搜索订单号 / 客户简称 / 客户全称 / 成本类型 / 供应商 / 备注"
            />
          </label>
          <label>
            业务范围
            <select value={archiveScope} onChange={(event) => onChangeArchiveScope(event.target.value)} disabled={loading}>
              <option value="current">当前业务</option>
              <option value="archive">已归档业务</option>
              <option value="all">全部业务</option>
            </select>
          </label>
        </div>

        <div className={styles.costFilterPrimaryRow}>
          <label>
            成本类型
            <select value={filters.costType} onChange={(event) => onSetFilter("costType", event.target.value)}>
              <option value="">全部成本类型</option>
              {COST_FILTER_TYPES.map((type) => (
                <option key={type} value={type}>{COST_FILTER_TYPE_LABELS[type] || type}</option>
              ))}
            </select>
          </label>
          <label>
            付款状态
            <select value={filters.paymentStatus} onChange={(event) => onSetFilter("paymentStatus", event.target.value)}>
              <option value="">全部付款状态</option>
              {COST_PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <div className={styles.costFilterActions}>
            <button className={styles.primaryButtonCompact} type="button" onClick={onSubmit} disabled={loading}>查询</button>
            <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={loading}>重置</button>
          </div>
        </div>

        <div className={styles.costFilterSecondaryRow}>
          <label>
            成本确认
            <select value={filters.costConfirmed} onChange={(event) => onSetFilter("costConfirmed", event.target.value)}>
              <option value="">全部确认状态</option>
              {COST_CONFIRMATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            发票状态
            <select value={costView === "invoiceExceptions" ? "未收到" : filters.invoiceStatus} onChange={(event) => onSetFilter("invoiceStatus", event.target.value)} disabled={costView === "invoiceExceptions"}>
              <option value="">全部发票状态</option>
              {COST_INVOICE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label>
            开始日期
            <input type="date" value={filters.dateFrom} onChange={(event) => onSetFilter("dateFrom", event.target.value)} />
          </label>
          <label>
            结束日期
            <input type="date" value={filters.dateTo} onChange={(event) => onSetFilter("dateTo", event.target.value)} />
          </label>
        </div>
      </div>
    </>
  );
}
