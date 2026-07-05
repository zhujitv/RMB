import styles from "../../WorkspaceShell.module.css";
import {
  CURRENCIES,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  type PaymentFilters,
} from "./types";

type Props = {
  filters: PaymentFilters;
  loading: boolean;
  onFilterChange: <K extends keyof PaymentFilters>(key: K, value: PaymentFilters[K]) => void;
  onSubmit: () => void;
  onReset: () => void;
};

export function PaymentFilterToolbar({
  filters,
  loading,
  onFilterChange,
  onSubmit,
  onReset,
}: Props) {
  return (
    <div className={styles.listToolbar}>
      <input
        value={filters.keyword}
        onChange={(event) => onFilterChange("keyword", event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
        }}
        placeholder="搜索订单号 / 客户简称 / 客户全称 / 备注"
      />
      <input value={filters.month} onChange={(event) => onFilterChange("month", event.target.value)} type="month" />
      <select value={filters.currency} onChange={(event) => onFilterChange("currency", event.target.value)} disabled={loading}>
        <option value="">全部币种</option>
        {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
      </select>
      <select value={filters.paymentType} onChange={(event) => onFilterChange("paymentType", event.target.value)} disabled={loading}>
        <option value="">全部收款类型</option>
        {PAYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      <select value={filters.paymentStatus} onChange={(event) => onFilterChange("paymentStatus", event.target.value)} disabled={loading}>
        <option value="">全部收款状态</option>
        {PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      <button className={styles.primaryButtonCompact} type="button" onClick={onSubmit} disabled={loading}>查询</button>
      <button className={styles.secondaryButton} type="button" onClick={onReset} disabled={loading}>重置</button>
    </div>
  );
}
