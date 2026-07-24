import { ConfirmationDialog, PaginationBar, type ConfirmationDialogState } from "../../components";
import { ResponsiveDataView } from "../../ResponsiveDataView";
import styles from "../../WorkspaceShell.module.css";
import { ProfitDetailDrawer, ProfitMobileCard, ProfitRows } from "./profit-panels";
import type { ProfitRow } from "./shared";

type ProfitModuleViewProps = {
  rows: ProfitRow[];
  total: number;
  page: number;
  totalPages: number;
  keyword: string;
  detailRow: ProfitRow | null;
  settlingId: string;
  reversingId: string;
  loading: boolean;
  error: string;
  notice: string;
  canSettleCommission: boolean;
  canReverseCommission: boolean;
  confirmation: ConfirmationDialogState | null;
  onKeywordChange: (value: string) => void;
  onSubmitSearch: () => void;
  onResetSearch: () => void;
  onRefresh: () => void;
  onPage: (page: number) => void;
  onSetDetailRow: (row: ProfitRow | null) => void;
  onSettle: (row: ProfitRow) => void;
  onReverse: (row: ProfitRow) => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
};

export function ProfitModuleView({
  rows, total, page, totalPages, keyword, detailRow, settlingId, reversingId,
  loading, error, notice, canSettleCommission, canReverseCommission, confirmation,
  onKeywordChange, onSubmitSearch, onResetSearch, onRefresh, onPage, onSetDetailRow,
  onSettle, onReverse, onCancelConfirmation, onConfirmConfirmation,
  onUpdateConfirmationInput,
}: ProfitModuleViewProps) {
  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div><h2>利润分析</h2></div>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={onRefresh}>
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") onSubmitSearch(); }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 业务员"
        />
        <button className={styles.primaryButtonCompact} type="button" onClick={onSubmitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={onResetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <ResponsiveDataView
        renderMobile={() => (
          <div>
            {loading ? (
              <div className={styles.emptyState}>数据加载中...</div>
            ) : rows.length ? rows.map((row) => (
              <ProfitMobileCard key={row.id} row={row} onViewDetail={() => onSetDetailRow(row)} />
            )) : (
              <div className={styles.emptyState}>未找到匹配的利润分析订单</div>
            )}
          </div>
        )}
        renderDesktop={() => (
          <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th className={styles.orderNoColumn}>订单号</th>
                  <th className={styles.customerColumn}>客户简称</th>
                  <th className={styles.amountColumn}>最终应收</th>
                  <th className={styles.amountColumn}>总成本</th>
                  <th className={styles.amountColumn}>预计毛利</th>
                  <th>预计毛利率</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7}><div className={styles.emptyState}>数据加载中...</div></td></tr>
                ) : rows.length ? rows.map((row) => (
                  <ProfitRows key={row.id} row={row} onViewDetail={() => onSetDetailRow(row)} />
                )) : (
                  <tr><td colSpan={7}><div className={styles.emptyState}>未找到匹配的利润分析订单</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      />

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={onPage} />
      {detailRow ? (
        <ProfitDetailDrawer
          row={detailRow}
          settling={settlingId === detailRow.id}
          reversing={reversingId === detailRow.id}
          canSettleCommission={canSettleCommission}
          canReverseCommission={canReverseCommission}
          onSettle={() => onSettle(detailRow)}
          onReverse={() => onReverse(detailRow)}
          onClose={() => onSetDetailRow(null)}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={onCancelConfirmation}
          onConfirm={onConfirmConfirmation}
          onInputChange={onUpdateConfirmationInput}
        />
      ) : null}
    </section>
  );
}
