import type { FormEvent } from "react";
import { PaginationBar } from "../components";
import { formatDate, formatDateTime } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import { getBusinessEntityRowClass } from "./business-entity-row-style";
import type { CommunicationRow } from "./customer-communication-types";

type CustomerCommunicationListProps = {
  rows: CommunicationRow[];
  keyword: string;
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string;
  notice: string;
  canManualMark: boolean;
  manualMarkBusyId: string;
  onKeywordChange: (value: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onRefresh: () => void;
  onPage: (page: number) => void;
  onOpenDetail: (id: string) => void;
  onToggleManualMark: (row: CommunicationRow) => void;
};

export function CustomerCommunicationList({
  rows, keyword, total, page, totalPages, loading, error, notice, canManualMark,
  manualMarkBusyId, onKeywordChange, onSearch, onReset, onRefresh, onPage,
  onOpenDetail, onToggleManualMark,
}: CustomerCommunicationListProps) {
  return (
    <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.moduleHeader}>
        <div><h2>客户沟通</h2><p>按订单集中处理客户清关资料邮件和发送记录。</p></div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" disabled={loading} onClick={onRefresh}>刷新</button>
        </div>
      </div>
      {notice ? <div className={styles.inlineSuccess}>{notice}</div> : null}
      {error ? <div className={styles.inlineError}>{error}</div> : null}
      <form className={styles.headerActions} onSubmit={onSearch}>
        <input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="订单号 / 客户简称 / 提单号" />
        <button className={styles.primaryButtonCompact} type="submit" disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={onReset}>重置</button>
      </form>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>订单号</th><th>客户简称</th><th>提单号</th><th>业务主体</th><th>申报日期</th>
              <th>物流状态</th><th>清关资料发送状态</th><th>最近发送时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}><div className={styles.emptyState}>正在加载客户沟通列表...</div></td></tr>
            ) : rows.length ? rows.map((row) => (
              <tr key={row.id} className={getBusinessEntityRowClass(row, styles)}>
                <td><strong>{row.orderNo || "-"}</strong></td>
                <td>{row.customerShortName || "-"}</td>
                <td>{row.billOfLadingNo || "-"}</td>
                <td>{row.businessEntityName || "-"}</td>
                <td>{formatDate(row.declarationDate)}</td>
                <td>{row.logisticsStatus || "-"}</td>
                <td><StatusBadge row={row} /></td>
                <td>{formatDateTime(row.latestSentAt)}</td>
                <td>
                  <div className={styles.inlineActionGroup}>
                    <button className={styles.secondaryButton} type="button" onClick={() => onOpenDetail(row.id)}>详情</button>
                    {canManualMark ? (
                      <button className={styles.secondaryButton} type="button" disabled={manualMarkBusyId === row.id} onClick={() => onToggleManualMark(row)}>
                        {manualMarkBusyId === row.id ? "处理中..." : manualMarkButtonLabel(row)}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={9}><div className={styles.emptyState}>未找到需要发送清关资料的订单</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={onPage} />
    </section>
  );
}

function StatusBadge({ row }: { row: CommunicationRow }) {
  const danger = ["FAILED", "MISSING"].includes(String(row.clearanceStatus || ""));
  const success = ["SENT", "MANUAL_SENT"].includes(String(row.clearanceStatus || ""));
  const className = `${styles.statusBadge} ${success ? styles.statusBadgeSuccess : danger ? styles.statusBadgeDanger : ""}`;
  return <span className={className}>{row.clearanceStatusLabel || "-"}</span>;
}

function manualMarkButtonLabel(row: CommunicationRow) {
  if (row.manualMarked || row.clearanceStatus === "MANUAL_SENT") return "取消标记";
  if (row.clearanceStatus === "SENT") return "重新标记";
  return "标记已发送";
}
