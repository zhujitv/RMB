import styles from "../../WorkspaceShell.module.css";
import {
  COST_TYPE_LABELS,
  COST_TYPES,
  COST_PAYMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  TAX_REFUND_STATUS_LABELS,
  TAX_REFUND_STATUSES,
  type BusinessEntityOption,
  type ReportFilters,
  type ReportType,
} from "./model";

type ReportFilterPanelProps = {
  reportType: string;
  visibleReportTypes: ReportType[];
  filters: ReportFilters;
  businessEntities: BusinessEntityOption[];
  showDeclarationMonth: boolean;
  loading: boolean;
  onReportTypeChange: (type: string) => void;
  onFilterChange: (name: keyof ReportFilters, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  onDatePreset: (preset: "month" | "previousMonth" | "quarter" | "year" | "all") => void;
};

export function ReportFilterPanel({
  reportType, visibleReportTypes, filters, businessEntities, showDeclarationMonth,
  loading, onReportTypeChange, onFilterChange, onSubmit, onReset, onDatePreset,
}: ReportFilterPanelProps) {
  const isCosts = reportType === "costs";
  const isPayments = reportType === "payments";
  const isTaxRefunds = reportType === "tax-refunds";
  const dateLabel = isPayments ? "到账日期" : isCosts ? "成本发生日期" : reportType === "overdue" ? "到期日期" : isTaxRefunds ? "申报日期" : "订单日期";
  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}><div><h2>报表中心</h2></div></div>
      <div className={styles.reportTabs}>
        {visibleReportTypes.map((type) => (
          <button
            key={type.key}
            className={type.key === reportType ? styles.reportTabActive : ""}
            type="button"
            onClick={() => onReportTypeChange(type.key)}
          >
            {type.label}
          </button>
        ))}
      </div>

      <div className={styles.listToolbar}>
        <span className={styles.filterHint}>快捷期间</span>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => onDatePreset("month")}>本月</button>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => onDatePreset("previousMonth")}>上月</button>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => onDatePreset("quarter")}>本季度</button>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => onDatePreset("year")}>本年</button>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => onDatePreset("all")}>全部期间</button>
      </div>

      <div className={styles.reportFilterGrid}>
        <label>{dateLabel}从<input value={filters.dateFrom} type="date" onChange={(event) => onFilterChange("dateFrom", event.target.value)} /></label>
        <label>{dateLabel}到<input value={filters.dateTo} type="date" onChange={(event) => onFilterChange("dateTo", event.target.value)} /></label>
        <label>客户名称<input value={filters.customerName} onChange={(event) => onFilterChange("customerName", event.target.value)} placeholder="客户全称或简称" /></label>
        <label>订单号<input value={filters.orderNo} onChange={(event) => onFilterChange("orderNo", event.target.value)} /></label>
        {!isPayments && !isCosts ? <label>提单号<input value={filters.blNo} onChange={(event) => onFilterChange("blNo", event.target.value)} /></label> : null}
        <label>关键词<input value={filters.keyword} onChange={(event) => onFilterChange("keyword", event.target.value)} placeholder="订单 / 客户 / 供应商 / 业务员" /></label>
        <label>币种<input value={filters.currency} onChange={(event) => onFilterChange("currency", event.target.value.toUpperCase())} placeholder="CNY / USD" /></label>
        <label>业务员<input value={filters.salespersonName} onChange={(event) => onFilterChange("salespersonName", event.target.value)} placeholder="业务员姓名" /></label>
        {isCosts ? <label>供应商<input value={filters.supplierName} onChange={(event) => onFilterChange("supplierName", event.target.value)} placeholder="供应商名称" /></label> : null}
        <label>业务主体
          <select value={filters.businessEntityId} onChange={(event) => onFilterChange("businessEntityId", event.target.value)}>
            <option value="">全部业务主体</option>
            {businessEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName || entity.shortName || entity.name}</option>)}
          </select>
        </label>
        {!isPayments && !isCosts && reportType !== "overdue" ? <label>订单状态
          <select value={filters.orderStatus} onChange={(event) => onFilterChange("orderStatus", event.target.value)}>
            {ORDER_STATUSES.map((status) => <option key={status || "all"} value={status}>{status || "全部"}</option>)}
          </select>
        </label> : null}
        {isPayments ? <label>收款状态
          <select value={filters.paymentStatus} onChange={(event) => onFilterChange("paymentStatus", event.target.value)}>
            {PAYMENT_STATUSES.map((status) => <option key={status || "all"} value={status}>{status || "全部"}</option>)}
          </select>
        </label> : null}
        {isCosts ? <label>付款状态
          <select value={filters.paymentStatus} onChange={(event) => onFilterChange("paymentStatus", event.target.value)}>
            {COST_PAYMENT_STATUSES.map((status) => <option key={status || "all"} value={status}>{status || "全部"}</option>)}
          </select>
        </label> : null}
        {isCosts ? <label>成本类型
          <select value={filters.costType} onChange={(event) => onFilterChange("costType", event.target.value)}>
            {COST_TYPES.map((costType) => <option key={costType || "all"} value={costType}>{COST_TYPE_LABELS[costType] || costType || "全部"}</option>)}
          </select>
        </label> : null}
        {isTaxRefunds ? <label>退税状态
          <select value={filters.taxRefundStatus} onChange={(event) => onFilterChange("taxRefundStatus", event.target.value)}>
            {TAX_REFUND_STATUSES.map((status) => <option key={status || "all"} value={status}>{status ? TAX_REFUND_STATUS_LABELS[status] || status : "全部"}</option>)}
          </select>
        </label> : null}
        {showDeclarationMonth ? (
          <label>申报月份<input value={filters.declarationMonth} type="month" onChange={(event) => onFilterChange("declarationMonth", event.target.value)} /></label>
        ) : null}
        {reportType !== "overdue" ? <label>业务范围
          <select value={filters.archiveScope} onChange={(event) => onFilterChange("archiveScope", event.target.value)}>
            <option value="current">当前业务</option>
            <option value="archive">已归档业务</option>
            <option value="all">全部业务</option>
          </select>
        </label> : null}
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="button" onClick={onSubmit} disabled={loading}>
          {loading ? "查询中..." : "查询"}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={loading}>重置</button>
      </div>
    </section>
  );
}
