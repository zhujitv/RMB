import { PaginationBar, UiCheckbox } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { EXPORT_ACTIONS, type ExportFormat, type ExportScope, type ReportColumn, type ReportRow, type SortDirection } from "./model";
import { ReportRows } from "./report-rows";

type ReportResultsPanelProps = {
  columns: ReportColumn[];
  visibleColumns: ReportColumn[];
  rows: ReportRow[];
  page: number;
  total: number;
  totalPages: number;
  queried: boolean;
  loading: boolean;
  downloading: boolean;
  error: string;
  notice: string;
  selectedIds: Set<string>;
  expandedId: string;
  sortBy: string;
  sortDir: SortDirection;
  allPageSelected: boolean;
  onExport: (scope: ExportScope, format: ExportFormat) => void;
  onTogglePageSelection: () => void;
  onToggleRowSelection: (row: ReportRow) => void;
  onToggleExpanded: (row: ReportRow) => void;
  onToggleSort: (key: string) => void;
  onOpenRecord: (row: ReportRow) => void;
  onPage: (page: number) => void;
};

export function ReportResultsPanel({
  columns, visibleColumns, rows, page, total, totalPages, queried, loading,
  downloading, error, notice, selectedIds, expandedId, sortBy, sortDir,
  allPageSelected, onExport, onTogglePageSelection, onToggleRowSelection,
  onToggleExpanded, onToggleSort, onOpenRecord, onPage,
}: ReportResultsPanelProps) {
  return (
    <section className={styles.moduleCard}>
      {queried ? (
        <div className={styles.reportDownloadBar}>
          <span>已查询 {total} 条，当前页 {rows.length} 条，已勾选 {selectedIds.size} 条</span>
          <div>
            {EXPORT_ACTIONS.map((action) => (
              <button
                key={`${action.scope}-${action.format}`}
                className={styles.secondaryButton}
                type="button"
                disabled={downloading || (action.scope === "selected" && selectedIds.size === 0)}
                onClick={() => onExport(action.scope, action.format)}
              >
                {downloading ? "下载中..." : action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>
                <UiCheckbox
                  label="全选当前页"
                  variant="table"
                  checked={allPageSelected}
                  disabled={!rows.length}
                  onChange={onTogglePageSelection}
                />
              </th>
              {visibleColumns.map((column) => (
                <th key={column.key} className={column.key === "businessEntityName" ? styles.businessEntityColumn : undefined}>
                  <button className={styles.tableSortButton} type="button" onClick={() => onToggleSort(column.key)}>
                    {column.label}
                    {sortBy === column.key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleColumns.length + 2}><div className={styles.emptyState}>数据加载中...</div></td></tr>
            ) : queried ? (
              rows.length ? rows.map((row) => (
                <ReportRows
                  key={String(row.id || JSON.stringify(row))}
                  row={row}
                  columns={columns}
                  visibleColumns={visibleColumns}
                  selected={Boolean(row.id && selectedIds.has(String(row.id)))}
                  expanded={expandedId === String(row.id)}
                  onToggle={() => onToggleExpanded(row)}
                  onSelect={() => onToggleRowSelection(row)}
                  onOpenRecord={() => onOpenRecord(row)}
                />
              )) : (
                <tr><td colSpan={visibleColumns.length + 2}><div className={styles.emptyState}>暂无匹配数据</div></td></tr>
              )
            ) : (
              <tr><td colSpan={visibleColumns.length + 2 || 8}><div className={styles.emptyState}>请选择报表类型并点击查询。</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {queried ? <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={onPage} /> : null}
    </section>
  );
}
