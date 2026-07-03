import { PaginationBar } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { TAX_REFUND_STATUS_OPTIONS, type BusinessEntityOption, type TaxRefundMode, type TaxRefundRow } from "./model";
import { TaxRefundTableRow } from "./table-row";
import { taxRowStatus } from "./helpers";

type TaxRefundListPanelProps = {
  mode: TaxRefundMode;
  rows: TaxRefundRow[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string;
  notice: string;
  keyword: string;
  declarationStartMonth: string;
  declarationEndMonth: string;
  statusFilter: string;
  businessEntityId: string;
  businessEntities: BusinessEntityOption[];
  canManageTaxRefund: boolean;
  canCancelArchive: boolean;
  submittingTaxId: string;
  onRefresh: () => void;
  onSwitchMode: (mode: TaxRefundMode) => void;
  onKeywordChange: (value: string) => void;
  onDeclarationStartMonthChange: (value: string) => void;
  onDeclarationEndMonthChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onBusinessEntityChange: (value: string) => void;
  onSubmitSearch: () => void;
  onResetSearch: () => void;
  onPage: (page: number) => void;
  onViewDetail: (row: TaxRefundRow) => void;
  onSubmitTaxRefund: (row: TaxRefundRow) => void;
  onCancelArchive: (row: TaxRefundRow) => void;
  onUpdateStatus: (row: TaxRefundRow, status: string) => void;
};

export function TaxRefundListPanel({
  mode,
  rows,
  total,
  page,
  totalPages,
  loading,
  error,
  notice,
  keyword,
  declarationStartMonth,
  declarationEndMonth,
  statusFilter,
  businessEntityId,
  businessEntities,
  canManageTaxRefund,
  canCancelArchive,
  submittingTaxId,
  onRefresh,
  onSwitchMode,
  onKeywordChange,
  onDeclarationStartMonthChange,
  onDeclarationEndMonthChange,
  onStatusFilterChange,
  onBusinessEntityChange,
  onSubmitSearch,
  onResetSearch,
  onPage,
  onViewDetail,
  onSubmitTaxRefund,
  onCancelArchive,
  onUpdateStatus,
}: TaxRefundListPanelProps) {
  return (
    <>
      <div className={styles.moduleHeader}>
        <div>
          <h2>退税资料</h2>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className={styles.listToolbar}>
        <button
          className={mode === "current" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          onClick={() => onSwitchMode("current")}
          disabled={loading && mode === "current"}
        >
          当前资料
        </button>
        <button
          className={mode === "archive" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          onClick={() => onSwitchMode("archive")}
          disabled={loading && mode === "archive"}
        >
          退税档案
        </button>
        <input
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 报关单号 / 提单号"
        />
        <input
          type="month"
          value={declarationStartMonth}
          onChange={(event) => onDeclarationStartMonthChange(event.target.value)}
          title="申报开始月份"
        />
        <input
          type="month"
          value={declarationEndMonth}
          onChange={(event) => onDeclarationEndMonthChange(event.target.value)}
          title="申报结束月份"
        />
        <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
          {TAX_REFUND_STATUS_OPTIONS.map((option) => (
            <option key={option.value || "all"} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select value={businessEntityId} onChange={(event) => onBusinessEntityChange(event.target.value)} title="业务主体">
          <option value="">全部业务主体</option>
          {businessEntities.map((entity) => (
            <option key={entity.id} value={entity.id}>{entity.displayName || entity.shortName || entity.name}</option>
          ))}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={onSubmitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={onResetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={`${styles.tableWrap} ${styles.taxRefundTableWrap}`}>
        <table className={`${styles.dataTable} ${styles.taxRefundTable}`}>
          <colgroup>
            <col className={styles.taxRefundOrderNoColumn} />
            <col className={styles.taxRefundBlNoColumn} />
            <col className={styles.taxRefundDeclarationNoColumn} />
            <col className={styles.taxRefundCustomerColumn} />
            <col className={styles.taxRefundSupplierColumn} />
            <col className={styles.taxRefundBusinessEntityColumn} />
            <col className={styles.taxRefundDateColumn} />
            <col className={styles.taxRefundCompletenessColumn} />
            <col className={styles.taxRefundStatusColumn} />
            <col className={styles.taxRefundActionColumn} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.taxRefundOrderNoColumn}>订单号</th>
              <th className={styles.taxRefundBlNoColumn}>提单号</th>
              <th className={styles.taxRefundDeclarationNoColumn}>报关单号</th>
              <th className={styles.taxRefundCustomerColumn}>客户简称</th>
              <th className={styles.taxRefundSupplierColumn}>供应商</th>
              <th className={styles.taxRefundBusinessEntityColumn}>业务主体</th>
              <th className={styles.taxRefundDateColumn}>申报日期</th>
              <th className={styles.taxRefundCompletenessColumn}>总体完整度</th>
              <th className={styles.taxRefundStatusColumn}>退税状态</th>
              <th className={styles.taxRefundActionColumn}>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, index) => (
                <tr key={`tax-refund-skeleton-${index}`}>
                  {Array.from({ length: 10 }).map((__, cellIndex) => (
                    <td key={cellIndex}>
                      <span className={styles.tableSkeletonLine} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length ? rows.map((row) => {
              const rowStatus = taxRowStatus(row);
              return (
                <TaxRefundTableRow
                  key={row.id}
                  row={row}
                  onViewDetail={() => onViewDetail(row)}
                  onSubmitTaxRefund={() => onSubmitTaxRefund(row)}
                  onCancelArchive={() => onCancelArchive(row)}
                  onUpdateStatus={(status) => onUpdateStatus(row, status)}
                  canSubmitTaxRefund={canManageTaxRefund && mode === "current" && !row.taxArchived && rowStatus === "READY"}
                  canCancelArchive={canCancelArchive && (mode === "archive" || row.taxArchived || rowStatus === "SUBMITTED")}
                  canUpdateStatus={canManageTaxRefund && mode === "current" && !row.taxArchived && rowStatus !== "SUBMITTED"}
                  submittingTax={submittingTaxId === row.id}
                />
              );
            }) : (
              <tr>
                <td colSpan={10}><div className={styles.emptyState}>未找到匹配的退税资料订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={onPage} />
    </>
  );
}
