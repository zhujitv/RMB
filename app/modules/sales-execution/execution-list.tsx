import { PaginationBar } from "../../components";
import { formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import styles from "./sales-execution.module.css";
import { salesExecutionStatusLabel, statusTone } from "./status-values";
import { businessEntityName, customerOrderNumber, executionCustomerName, salesExecutionTotal, type SalesExecutionRow } from "./types";

function statusClass(status: unknown, shippingStarted = false, linkedOrderStatus?: unknown) {
  const tone = statusTone(status, shippingStarted, linkedOrderStatus);
  if (tone === "success") return shell.statusSuccess;
  if (tone === "warning") return shell.statusWarning;
  if (tone === "danger") return shell.statusDanger;
  return shell.statusMuted;
}

export function ExecutionList({
  rows,
  loading,
  page,
  total,
  totalPages,
  onPage,
  onOpen,
}: {
  rows: SalesExecutionRow[];
  loading: boolean;
  page: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  onOpen: (row: SalesExecutionRow) => void;
}) {
  return (
    <>
      <div className={`${shell.tableWrap} ${shell.tablePinnedTwoCols}`}>
        <table className={shell.dataTable}>
          <thead>
            <tr>
              <th className={shell.orderNoColumn}>客户订单号</th>
              <th className={shell.customerColumn}>客户</th>
              <th>来源</th>
              <th>业务主体</th>
              <th className={shell.amountColumn}>销售金额</th>
              <th>客户要求交货日</th>
              <th className={shell.statusColumn}>状态</th>
              <th className={shell.operationColumn}>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}><div className={shell.emptyState}>销售执行数据加载中...</div></td></tr>
            ) : rows.length ? rows.map((row) => (
              <tr className={shell.clickableRow} key={row.id} onClick={() => onOpen(row)}>
                <td className={shell.orderNoColumn}><strong>{customerOrderNumber(row) || "-"}</strong></td>
                <td className={shell.customerColumn}><span className={styles.customerCell}><strong>{executionCustomerName(row)}</strong><small>{row.customer?.fullName || row.customerNameSnapshot || ""}</small></span></td>
                <td><span className={`${styles.sourcePill} ${row.sourceType === "QUOTATION" ? styles.sourceQuote : ""}`}>{row.sourceType === "QUOTATION" ? "报价转入" : "直接创建"}</span></td>
                <td>{businessEntityName(row.businessEntity) !== "-" ? businessEntityName(row.businessEntity) : row.businessEntityNameSnapshot || "-"}</td>
                <td className={shell.amountColumn}>{formatCurrencyAmount(row.currency || "CNY", salesExecutionTotal(row))}</td>
                <td>{formatDate(row.requestedDeliveryDate)}</td>
                <td className={shell.statusColumn}><span className={`${shell.statusPill} ${statusClass(row.status, Boolean(row.receivableOrder || row.shippingStartedAt), row.receivableOrder?.status)}`}>{salesExecutionStatusLabel(row.status, Boolean(row.receivableOrder || row.shippingStartedAt), row.receivableOrder?.status)}</span></td>
                <td className={shell.operationColumn}><button className={shell.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onOpen(row); }}>详情</button></td>
              </tr>
            )) : (
              <tr><td colSpan={8}><div className={shell.emptyState}>未找到匹配的销售执行记录</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={onPage} />
    </>
  );
}
