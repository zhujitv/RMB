"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../api";
import type { PermissionSnapshot, User } from "../types";
import { canReadPermission } from "../utils";
import { useWorkspaceTabBusy, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";
import {
  DEFAULT_REPORT_FILTERS,
  PAGE_SIZE,
  primaryReportColumns,
  REPORT_READ_ROLES,
  REPORT_TYPES,
  type ExportFormat,
  type ExportScope,
  type OpenMenuTarget,
  type ReportColumn,
  type ReportFilters,
  type ReportResponse,
  type ReportRow,
  type ReportSummary,
  type SortDirection,
} from "./reports/model";
import { reportDatePreset, type ReportDatePreset } from "./reports/report-date-presets";
import { downloadReport } from "./reports/report-export";
import { openReportRecord } from "./reports/report-navigation";
import { ReportsWorkspace } from "./reports/report-workspace";
import { useBusinessEntities } from "./reports/use-business-entities";

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
  const [summary, setSummary] = useState<ReportSummary>();
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
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
  const businessEntities = useBusinessEntities();
  const queryRequestRef = useRef(0);

  const visibleColumns = useMemo(() => primaryReportColumns(reportType, columns), [columns, reportType]);
  const allPageSelected = rows.length > 0 && rows.every((row) => row.id && selectedIds.has(String(row.id)));
  const showDeclarationMonth = reportType === "tax-refunds";
  const activeReportLabel = visibleReportTypes.find((type) => type.key === reportType)?.label || "业务报表";
  useWorkspaceTabBusy(downloading);

  useWorkspaceTabPresentation({
    title: `报表 · ${activeReportLabel}`,
    view: "report",
    contextKey: `report:${reportType}`,
  });
  useWorkspaceTabReactivation(() => {
    if (queried) void queryRows(page, submittedFilters, sortBy, sortDir);
  });

  useEffect(() => {
    if (!visibleReportTypes.length) return;
    if (!visibleReportTypes.some((type) => type.key === reportType)) {
      setReportType(visibleReportTypes[0].key);
    }
  }, [reportType, visibleReportTypes]);

  useEffect(() => {
    const initialFilters = { ...DEFAULT_REPORT_FILTERS };
    setFilters(initialFilters);
    setSubmittedFilters(initialFilters);
    clearResults();
    setSortBy("");
    setSortDir("asc");
    void queryRows(1, initialFilters, "", "asc", reportType);
  }, [reportType]);

  function updateFilter(name: keyof ReportFilters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function queryRows(
    nextPage = 1,
    nextFilters = submittedFilters,
    nextSortBy = sortBy,
    nextSortDir = sortDir,
    nextReportType = reportType,
  ) {
    const requestId = ++queryRequestRef.current;
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
      const result = await apiJson<ReportResponse>(`/api/reports/${encodeURIComponent(nextReportType)}?${params}`);
      if (requestId !== queryRequestRef.current) return;
      setColumns(Array.isArray(result.columns) ? result.columns : []);
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setSummary(result.summary);
      setDataWarnings(Array.isArray(result.dataWarnings) ? result.dataWarnings : []);
      setPage(Number(result.pagination?.page || nextPage));
      setTotal(Number(result.pagination?.total || 0));
      setTotalPages(Math.max(1, Number(result.pagination?.totalPages || 1)));
      setQueried(true);
      setExpandedId("");
      setNotice(`报表查询完成，共 ${Number(result.pagination?.total || 0)} 条`);
    } catch (loadError) {
      if (requestId !== queryRequestRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "查询报表失败");
    } finally {
      if (requestId === queryRequestRef.current) setLoading(false);
    }
  }

  function submitSearch() {
    const nextFilters = { ...filters };
    setSubmittedFilters(nextFilters);
    setSelectedIds(new Set());
    void queryRows(1, nextFilters, sortBy, sortDir);
  }

  function resetSearch() {
    const initialFilters = { ...DEFAULT_REPORT_FILTERS };
    setFilters(initialFilters);
    setSubmittedFilters(initialFilters);
    clearResults();
    setSortBy("");
    setSortDir("asc");
    void queryRows(1, initialFilters, "", "asc");
  }

  function clearResults() {
    queryRequestRef.current += 1;
    setLoading(false);
    setColumns([]);
    setRows([]);
    setSummary(undefined);
    setDataWarnings([]);
    setPage(1);
    setTotal(0);
    setTotalPages(1);
    setQueried(false);
    setSelectedIds(new Set());
    setExpandedId("");
    setError("");
    setNotice("");
  }

  function applyDatePreset(preset: ReportDatePreset) {
    const range = reportDatePreset(preset);
    const nextFilters = { ...filters, ...range };
    setFilters(nextFilters);
    setSubmittedFilters(nextFilters);
    setSelectedIds(new Set());
    void queryRows(1, nextFilters, sortBy, sortDir);
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
      await downloadReport({
        reportType,
        filters: submittedFilters,
        selectedIds: [...selectedIds],
        exportScope: scope,
        format,
        page,
        sortBy,
        sortDir,
      });
      setNotice("报表已开始下载");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "下载报表失败");
    } finally {
      setDownloading(false);
    }
  }

  function openRecord(row: ReportRow) {
    openReportRecord(reportType, row, onOpenRecord);
  }

  return (
    <ReportsWorkspace
      reportType={reportType}
      visibleReportTypes={visibleReportTypes}
      filters={filters}
      businessEntities={businessEntities}
      showDeclarationMonth={showDeclarationMonth}
      loading={loading}
      columns={columns}
      visibleColumns={visibleColumns}
      rows={rows}
      summary={summary}
      dataWarnings={dataWarnings}
      page={page}
      total={total}
      totalPages={totalPages}
      queried={queried}
      downloading={downloading}
      error={error}
      notice={notice}
      selectedIds={selectedIds}
      expandedId={expandedId}
      sortBy={sortBy}
      sortDir={sortDir}
      allPageSelected={allPageSelected}
      onReportTypeChange={setReportType}
      onFilterChange={updateFilter}
      onSubmit={submitSearch}
      onReset={resetSearch}
      onDatePreset={applyDatePreset}
      onExport={(scope, format) => void exportRows(scope, format)}
      onTogglePageSelection={togglePageSelection}
      onToggleRowSelection={toggleRowSelection}
      onToggleExpanded={(row) => setExpandedId((current) => current === String(row.id) ? "" : String(row.id))}
      onToggleSort={toggleSort}
      onOpenRecord={openRecord}
      onPage={(nextPage) => void queryRows(nextPage, submittedFilters, sortBy, sortDir)}
    />
  );
}
