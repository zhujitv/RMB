import type {
  BusinessEntityOption,
  ExportFormat,
  ExportScope,
  ReportColumn,
  ReportFilters,
  ReportRow,
  ReportSummary,
  ReportType,
  SortDirection,
} from "./model";
import { ReportFilterPanel } from "./report-filter-panel";
import { ReportResultsPanel } from "./report-results-panel";

type DatePreset = "month" | "previousMonth" | "quarter" | "year" | "all";

type ReportsWorkspaceProps = {
  reportType: string;
  visibleReportTypes: ReportType[];
  filters: ReportFilters;
  businessEntities: BusinessEntityOption[];
  showDeclarationMonth: boolean;
  loading: boolean;
  columns: ReportColumn[];
  visibleColumns: ReportColumn[];
  rows: ReportRow[];
  summary?: ReportSummary;
  dataWarnings: string[];
  page: number;
  total: number;
  totalPages: number;
  queried: boolean;
  downloading: boolean;
  error: string;
  notice: string;
  selectedIds: Set<string>;
  expandedId: string;
  sortBy: string;
  sortDir: SortDirection;
  allPageSelected: boolean;
  onReportTypeChange: (type: string) => void;
  onFilterChange: (name: keyof ReportFilters, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  onDatePreset: (preset: DatePreset) => void;
  onExport: (scope: ExportScope, format: ExportFormat) => void;
  onTogglePageSelection: () => void;
  onToggleRowSelection: (row: ReportRow) => void;
  onToggleExpanded: (row: ReportRow) => void;
  onToggleSort: (columnKey: string) => void;
  onOpenRecord: (row: ReportRow) => void;
  onPage: (nextPage: number) => void;
};

export function ReportsWorkspace({
  reportType,
  visibleReportTypes,
  filters,
  businessEntities,
  showDeclarationMonth,
  loading,
  ...results
}: ReportsWorkspaceProps) {
  return (
    <section>
      <ReportFilterPanel
        reportType={reportType}
        visibleReportTypes={visibleReportTypes}
        filters={filters}
        businessEntities={businessEntities}
        showDeclarationMonth={showDeclarationMonth}
        loading={loading}
        onReportTypeChange={results.onReportTypeChange}
        onFilterChange={results.onFilterChange}
        onSubmit={results.onSubmit}
        onReset={results.onReset}
        onDatePreset={results.onDatePreset}
      />
      <ReportResultsPanel
        columns={results.columns}
        visibleColumns={results.visibleColumns}
        rows={results.rows}
        summary={results.summary}
        dataWarnings={results.dataWarnings}
        page={results.page}
        total={results.total}
        totalPages={results.totalPages}
        queried={results.queried}
        loading={loading}
        downloading={results.downloading}
        error={results.error}
        notice={results.notice}
        selectedIds={results.selectedIds}
        expandedId={results.expandedId}
        sortBy={results.sortBy}
        sortDir={results.sortDir}
        allPageSelected={results.allPageSelected}
        onExport={results.onExport}
        onTogglePageSelection={results.onTogglePageSelection}
        onToggleRowSelection={results.onToggleRowSelection}
        onToggleExpanded={results.onToggleExpanded}
        onToggleSort={results.onToggleSort}
        onOpenRecord={results.onOpenRecord}
        onPage={results.onPage}
      />
    </section>
  );
}
