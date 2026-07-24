import { downloadBlob } from "../../utils";
import {
  PAGE_SIZE,
  reportFileName,
  type ExportFormat,
  type ExportScope,
  type ReportFilters,
  type SortDirection,
} from "./model";

type ReportExportRequest = {
  reportType: string;
  filters: ReportFilters;
  selectedIds: string[];
  exportScope: ExportScope;
  format: ExportFormat;
  page: number;
  sortBy: string;
  sortDir: SortDirection;
};

export async function downloadReport(request: ReportExportRequest) {
  const response = await fetch("/api/reports/export", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, pageSize: PAGE_SIZE }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data && typeof data === "object" && "message" in data && typeof data.message === "string"
      ? data.message
      : data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "下载报表失败";
    throw new Error(message);
  }
  downloadBlob(await response.blob(), reportFileName(request.reportType, request.format));
}
