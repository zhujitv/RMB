"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar } from "../components";
import { canReadPermission, customerDisplayName, customerLegalName, downloadBlob } from "../utils";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";

type ReportType = {
  key: string;
  label: string;
  area: string;
};

type ReportColumn = {
  key: string;
  label: string;
};

type ReportRow = Record<string, unknown> & {
  id?: string;
  orderId?: string;
  customerFullName?: string;
  customerName?: string;
  customerShortName?: string;
  orderNo?: string;
  taxRefundStatus?: string;
};

type ReportResponse = {
  reportType: string;
  label: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type ExportScope = "currentPage" | "selected" | "allFiltered";
type ExportFormat = "xlsx" | "csv";
type SortDirection = "asc" | "desc";
type OpenMenuTarget = "orders" | "payments" | "costs" | "taxRefund";

const PAGE_SIZE = 20;
const DEFAULT_REPORT_FILTERS = {
  dateFrom: "",
  dateTo: "",
  customerName: "",
  orderNo: "",
  blNo: "",
  currency: "",
  salespersonName: "",
  supplierName: "",
  orderStatus: "",
  paymentStatus: "",
  costType: "",
  taxRefundStatus: "",
  declarationMonth: "",
  archiveScope: "current",
  keyword: "",
};

type ReportFilters = typeof DEFAULT_REPORT_FILTERS;

const REPORT_TYPES: ReportType[] = [
  { key: "receivables", label: "应收订单明细", area: "orders" },
  { key: "payments", label: "收款明细", area: "payments" },
  { key: "costs", label: "成本明细", area: "costs" },
  { key: "profits", label: "利润分析", area: "commissions" },
  { key: "commissions", label: "业务员提成", area: "commissions" },
  { key: "overdue", label: "逾期催款", area: "orders" },
  { key: "tax-refunds", label: "退税资料", area: "taxRefund" },
];

const REPORT_READ_ROLES: Record<string, string[]> = {
  orders: ["管理员", "业务员", "财务"],
  payments: ["管理员", "业务员", "财务"],
  costs: ["管理员", "业务员", "财务"],
  commissions: ["管理员", "财务"],
  taxRefund: ["管理员", "业务员", "财务"],
};

const ORDER_STATUSES = ["", "草稿", "已确认", "部分收款", "已收齐", "多收款", "已逾期", "已关闭", "已取消"];
const PAYMENT_STATUSES = ["", "待确认", "已到账", "已退回", "已取消"];
const COST_TYPES = ["", "工厂货款", "原材料货款", "采购货款", "产品货款", "拖车费", "报关费", "港杂费", "海运费", "保险费", "银行手续费", "国外佣金", "样品费", "其他物流费用", "其他费用"];
const TAX_REFUND_STATUSES = ["", "NOT_READY", "READY", "PROBLEM", "SUBMITTED"];
const TAX_REFUND_STATUS_LABELS: Record<string, string> = {
  NOT_READY: "资料不完整",
  READY: "资料完整待提交",
  PROBLEM: "资料异常",
  SUBMITTED: "已提交退税",
};

const HIDDEN_DETAIL_KEYS = new Set(["id", "orderId", "customerId", "supplierId", "userId", "paymentId", "costId", "documentId"]);
const EXPORT_ACTIONS: { scope: ExportScope; format: ExportFormat; label: string }[] = [
  { scope: "currentPage", format: "xlsx", label: "当前页 Excel" },
  { scope: "currentPage", format: "csv", label: "当前页 CSV" },
  { scope: "selected", format: "xlsx", label: "已勾选 Excel" },
  { scope: "selected", format: "csv", label: "已勾选 CSV" },
  { scope: "allFiltered", format: "xlsx", label: "查询结果 Excel" },
  { scope: "allFiltered", format: "csv", label: "查询结果 CSV" },
];

export function ReportsModule({
  currentUser,
  permissions,
  onOpenRecord,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  onOpenRecord?: (targetMenu: OpenMenuTarget, keyword: string) => void;
}) {
  const visibleReportTypes = useMemo(
    () => REPORT_TYPES.filter((type) => canReadPermission(currentUser, permissions, type.area, REPORT_READ_ROLES[type.area] || [])),
    [currentUser, permissions],
  );
  const defaultReportType = visibleReportTypes[0]?.key || "receivables";

  const [reportType, setReportType] = useState(defaultReportType);
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [submittedFilters, setSubmittedFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [queried, setQueried] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const visibleColumns = useMemo(() => columns.slice(0, 5), [columns]);
  const allPageSelected = rows.length > 0 && rows.every((row) => row.id && selectedIds.has(String(row.id)));
  const showDeclarationMonth = reportType === "tax-refunds";

  useEffect(() => {
    if (!visibleReportTypes.length) return;
    if (!visibleReportTypes.some((type) => type.key === reportType)) {
      setReportType(visibleReportTypes[0].key);
    }
  }, [reportType, visibleReportTypes]);

  useEffect(() => {
    clearResults();
    setSortBy("");
    setSortDir("asc");
  }, [reportType]);

  function updateFilter(name: keyof ReportFilters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function queryRows(
    nextPage = 1,
    nextFilters = submittedFilters,
    nextSortBy = sortBy,
    nextSortDir = sortDir,
  ) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE) });
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      if (nextSortBy) params.set("sortBy", nextSortBy);
      if (nextSortDir) params.set("sortDir", nextSortDir);
      const result = await apiJson<ReportResponse>(`/api/reports/${encodeURIComponent(reportType)}?${params}`);
      setColumns(Array.isArray(result.columns) ? result.columns : []);
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setPage(Number(result.pagination?.page || nextPage));
      setTotal(Number(result.pagination?.total || 0));
      setTotalPages(Math.max(1, Number(result.pagination?.totalPages || 1)));
      setQueried(true);
      setExpandedId("");
      setNotice(`报表查询完成，共 ${Number(result.pagination?.total || 0)} 条`);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "查询报表失败");
    } finally {
      setLoading(false);
    }
  }

  function submitSearch() {
    const nextFilters = { ...filters };
    setSubmittedFilters(nextFilters);
    setSelectedIds(new Set());
    void queryRows(1, nextFilters, sortBy, sortDir);
  }

  function resetSearch() {
    setFilters(DEFAULT_REPORT_FILTERS);
    setSubmittedFilters(DEFAULT_REPORT_FILTERS);
    clearResults();
    setSortBy("");
    setSortDir("asc");
  }

  function clearResults() {
    setColumns([]);
    setRows([]);
    setPage(1);
    setTotal(0);
    setTotalPages(1);
    setQueried(false);
    setSelectedIds(new Set());
    setExpandedId("");
    setError("");
    setNotice("");
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) {
        rows.forEach((row) => row.id && next.delete(String(row.id)));
      } else {
        rows.forEach((row) => row.id && next.add(String(row.id)));
      }
      return next;
    });
  }

  function toggleRowSelection(row: ReportRow) {
    if (!row.id) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      const id = String(row.id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSort(columnKey: string) {
    const nextDir: SortDirection = sortBy === columnKey && sortDir === "asc" ? "desc" : "asc";
    setSortBy(columnKey);
    setSortDir(nextDir);
    if (queried) {
      void queryRows(1, submittedFilters, columnKey, nextDir);
    }
  }

  async function exportRows(scope: ExportScope, format: ExportFormat) {
    if (!queried) {
      setError("请先查询报表。");
      return;
    }
    if (scope === "selected" && selectedIds.size === 0) {
      setError("请先勾选要下载的数据。");
      return;
    }
    setDownloading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/reports/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType,
          filters: submittedFilters,
          selectedIds: [...selectedIds],
          exportScope: scope,
          format,
          page,
          pageSize: PAGE_SIZE,
          sortBy,
          sortDir,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.message === "string" ? data.message : "下载报表失败");
      }
      const blob = await response.blob();
      downloadBlob(blob, reportFileName(reportType, format));
      setNotice("报表已开始下载");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "下载报表失败");
    } finally {
      setDownloading(false);
    }
  }

  function openRecord(row: ReportRow) {
    const keyword = String(row.orderNo || row.customerShortName || row.customerName || row.id || "").trim();
    if (!keyword || !onOpenRecord) return;
    if (reportType === "payments") {
      onOpenRecord("payments", keyword);
      return;
    }
    if (reportType === "costs") {
      onOpenRecord("costs", keyword);
      return;
    }
    if (reportType === "tax-refunds") {
      onOpenRecord("taxRefund", keyword);
      return;
    }
    onOpenRecord("orders", keyword);
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>报表中心</h2>
        </div>
      </div>

      <div className={styles.reportTabs}>
        {visibleReportTypes.map((type) => (
          <button
            key={type.key}
            className={type.key === reportType ? styles.reportTabActive : ""}
            type="button"
            onClick={() => setReportType(type.key)}
          >
            {type.label}
          </button>
        ))}
      </div>

      <div className={styles.reportFilterGrid}>
        <label>日期从<input value={filters.dateFrom} type="date" onChange={(event) => updateFilter("dateFrom", event.target.value)} /></label>
        <label>日期到<input value={filters.dateTo} type="date" onChange={(event) => updateFilter("dateTo", event.target.value)} /></label>
        <label>客户名称<input value={filters.customerName} onChange={(event) => updateFilter("customerName", event.target.value)} placeholder="客户全称或简称" /></label>
        <label>订单号<input value={filters.orderNo} onChange={(event) => updateFilter("orderNo", event.target.value)} /></label>
        <label>提单号<input value={filters.blNo} onChange={(event) => updateFilter("blNo", event.target.value)} /></label>
        <label>关键词<input value={filters.keyword} onChange={(event) => updateFilter("keyword", event.target.value)} placeholder="订单 / 客户 / 供应商 / 业务员" /></label>
        <label>币种<input value={filters.currency} onChange={(event) => updateFilter("currency", event.target.value.toUpperCase())} placeholder="CNY / USD" /></label>
        <label>业务员<input value={filters.salespersonName} onChange={(event) => updateFilter("salespersonName", event.target.value)} placeholder="业务员姓名" /></label>
        <label>供应商<input value={filters.supplierName} onChange={(event) => updateFilter("supplierName", event.target.value)} placeholder="供应商名称" /></label>
        <label>订单状态
          <select value={filters.orderStatus} onChange={(event) => updateFilter("orderStatus", event.target.value)}>
            {ORDER_STATUSES.map((status) => <option key={status || "all"} value={status}>{status || "全部"}</option>)}
          </select>
        </label>
        <label>收款状态
          <select value={filters.paymentStatus} onChange={(event) => updateFilter("paymentStatus", event.target.value)}>
            {PAYMENT_STATUSES.map((status) => <option key={status || "all"} value={status}>{status || "全部"}</option>)}
          </select>
        </label>
        <label>成本类型
          <select value={filters.costType} onChange={(event) => updateFilter("costType", event.target.value)}>
            {COST_TYPES.map((costType) => <option key={costType || "all"} value={costType}>{costType || "全部"}</option>)}
          </select>
        </label>
        <label>退税状态
          <select value={filters.taxRefundStatus} onChange={(event) => updateFilter("taxRefundStatus", event.target.value)}>
            {TAX_REFUND_STATUSES.map((status) => <option key={status || "all"} value={status}>{status ? TAX_REFUND_STATUS_LABELS[status] || status : "全部"}</option>)}
          </select>
        </label>
        {showDeclarationMonth ? (
          <label>申报月份<input value={filters.declarationMonth} type="month" onChange={(event) => updateFilter("declarationMonth", event.target.value)} /></label>
        ) : null}
        <label>业务范围
          <select value={filters.archiveScope} onChange={(event) => updateFilter("archiveScope", event.target.value)}>
            <option value="current">当前业务</option>
            <option value="archive">已归档业务</option>
            <option value="all">全部业务</option>
          </select>
        </label>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>
          {loading ? "查询中..." : "查询"}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

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
                onClick={() => exportRows(action.scope, action.format)}
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
                <input aria-label="全选当前页" type="checkbox" checked={allPageSelected} disabled={!rows.length} onChange={togglePageSelection} />
              </th>
              {visibleColumns.map((column) => (
                <th key={column.key}>
                  <button className={styles.tableSortButton} type="button" onClick={() => toggleSort(column.key)}>
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
              <tr>
                <td colSpan={visibleColumns.length + 2}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : queried ? (
              rows.length ? rows.map((row) => (
                <ReportRows
                  key={String(row.id || JSON.stringify(row))}
                  row={row}
                  columns={columns}
                  visibleColumns={visibleColumns}
                  selected={Boolean(row.id && selectedIds.has(String(row.id)))}
                  expanded={expandedId === String(row.id)}
                  onToggle={() => setExpandedId((current) => current === String(row.id) ? "" : String(row.id))}
                  onSelect={() => toggleRowSelection(row)}
                  onOpenRecord={() => openRecord(row)}
                />
              )) : (
                <tr>
                  <td colSpan={visibleColumns.length + 2}><div className={styles.emptyState}>未找到匹配的报表数据</div></td>
                </tr>
              )
            ) : (
              <tr>
                <td colSpan={visibleColumns.length + 2 || 8}><div className={styles.emptyState}>请选择报表类型并点击查询。</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {queried ? (
        <PaginationBar
          total={total}
          page={page}
          totalPages={totalPages}
          loading={loading}
          onPage={(nextPage) => queryRows(nextPage, submittedFilters, sortBy, sortDir)}
        />
      ) : null}
    </section>
  );
}

function ReportRows({
  row,
  columns,
  visibleColumns,
  selected,
  expanded,
  onToggle,
  onSelect,
  onOpenRecord,
}: {
  row: ReportRow;
  columns: ReportColumn[];
  visibleColumns: ReportColumn[];
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onOpenRecord: () => void;
}) {
  const colSpan = visibleColumns.length + 2;
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td>
          <input
            aria-label="选择此行"
            type="checkbox"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={onSelect}
          />
        </td>
        {visibleColumns.map((column) => <td key={column.key}>{displayValue(row, column)}</td>)}
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={colSpan}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenRecord(); }}>
                  查看详情
                </button>
              </div>
              <div className={styles.detailGrid}>
                {columns
                  .filter((column) => !HIDDEN_DETAIL_KEYS.has(column.key))
                  .map((column) => (
                    <DetailField
                      key={column.key}
                      label={column.label === "客户简称" ? "客户全称" : column.label}
                      value={column.label === "客户简称"
                        ? customerLegalName(row)
                        : String(row[column.key] ?? "-")}
                      wide={String(row[column.key] ?? "").length > 36}
                    />
                  ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function displayValue(row: ReportRow, column: ReportColumn) {
  const value = column.label === "客户简称"
    ? customerDisplayName(row)
    : row[column.key];
  return String(value ?? "-");
}

function reportFileName(type: string, format: string) {
  const label = REPORT_TYPES.find((item) => item.key === type)?.label || "报表";
  return `${label}.${format === "xlsx" ? "xlsx" : "csv"}`;
}
