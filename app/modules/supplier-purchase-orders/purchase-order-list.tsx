import styles from "./supplier-purchase-orders.module.css";
import { formatDate, statusLabel } from "./presentation";
import type { SupplierPurchaseOrderDto } from "./types";

function hasPendingVariance(row: SupplierPurchaseOrderDto) {
  return row.deliveryQuantityVariances.some((entry) => entry.status === "PENDING");
}

function hasPendingLoadingResult(row: SupplierPurchaseOrderDto) {
  return row.containerLoads.some((load) => load.loadingResults.some((entry) => entry.status === "PENDING"));
}

type Props = {
  rows: SupplierPurchaseOrderDto[];
  loading: boolean;
  error: string;
  keyword: string;
  status: string;
  page: number;
  total: number;
  totalPages: number;
  onKeywordChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onSearch: (keyword: string) => void;
  onRefresh: () => void;
  onPageChange: (page: number) => void;
  onOpen: (id: string) => void;
};

export function SupplierPurchaseOrderList({
  rows,
  loading,
  error,
  keyword,
  status,
  page,
  total,
  totalPages,
  onKeywordChange,
  onStatusChange,
  onSearch,
  onRefresh,
  onPageChange,
  onOpen,
}: Props) {
  return (
    <section className={styles.module}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>供应商门户</p>
          <h2>工厂采购单</h2>
          <p className={styles.subtitle}>查看已正式下发给本工厂的采购单，并确认交期或反馈调整。</p>
        </div>
        <span className={styles.muted}>共 {total} 张</span>
      </header>

      <form
        className={styles.toolbar}
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(keyword.trim());
        }}
      >
        <div className={styles.filters}>
          <label className={styles.field}>
            采购单号 / 客户订单号
            <input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="输入采购单号或客户订单号" />
          </label>
          <label className={styles.field}>
            回复状态
            <select value={status} onChange={(event) => onStatusChange(event.target.value)}>
              <option value="">全部状态</option>
              <option value="DISPATCHED">待回复</option>
              <option value="ACCEPTED">已接受</option>
              <option value="DELIVERY_PROPOSED">已提出新交期</option>
              <option value="REJECTED">已拒绝</option>
            </select>
          </label>
          <button className={styles.primaryButton} type="submit">查询</button>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={onRefresh} disabled={loading}>刷新</button>
      </form>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>采购单号</th><th>客户订单号</th><th>下发时间</th><th>原要求交期</th><th>币种</th><th>产品行</th><th>回复状态</th><th style={{ width: "100px" }}>操作</th></tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8}><div className={styles.loading}>正在读取采购单...</div></td></tr> : null}
            {!loading && !rows.length ? <tr><td colSpan={8}><div className={styles.empty}>暂无已下发的工厂采购单</div></td></tr> : null}
            {!loading ? rows.map((row) => (
              <tr key={row.id}>
                <td className={styles.orderNumber}>{row.poNo}</td>
                <td className={styles.orderNumber}>{row.customerOrderNo || "-"}</td>
                <td>{formatDate(row.dispatchedAt, true)}</td>
                <td>{formatDate(row.requestedDeliveryDate)}</td>
                <td>{row.purchaseCurrency || "-"}</td>
                <td>{row.items.length}</td>
                <td><div className={styles.statusStack}><span className={styles.status} data-status={row.status}>{statusLabel(row.status)}</span>{hasPendingVariance(row) ? <span className={styles.status}>数量差异待审批</span> : null}{hasPendingLoadingResult(row) ? <span className={styles.status}>本柜实装差异待确认</span> : null}</div></td>
                <td><button className={styles.linkButton} type="button" onClick={() => onOpen(row.id)}>查看</button></td>
              </tr>
            )) : null}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <span>第 {page} / {totalPages} 页</span>
        <div className={styles.actions}>
          <button className={styles.secondaryButton} type="button" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
          <button className={styles.secondaryButton} type="button" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</button>
        </div>
      </div>
    </section>
  );
}
