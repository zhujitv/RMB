import JSZip from "jszip";
import { apiError, assertRead, getActor, parseJsonBody } from "./platform-db";
import { queryReport } from "./report-service-query";
import {
  REPORT_TYPES,
  recordFrom,
  reportTypeFrom,
  stringArrayFrom,
  text,
  type ActorLike,
  type ReportColumn,
  type ReportRow,
} from "./report-service-shared";

function csvCell(value: unknown) {
  let valueText = text(value);
  if (/^[=+\-@]/.test(valueText.trimStart())) {
    valueText = `'${valueText}`;
  }
  return /[",\n]/.test(valueText) ? `"${valueText.replaceAll('"', '""')}"` : valueText;
}

function csvResponse(filename: string, columns: ReportColumn[], rows: ReportRow[]) {
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(",")).join("\n");
  return new Response(`\ufeff${header}\n${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}

function xmlCell(value: unknown) {
  return text(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function excelColumnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

async function xlsxResponse(filename: string, columns: ReportColumn[], rows: ReportRow[]) {
  const values = [columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => row[column.key]))];
  const sheetData = values.map((row, rowIndex) => `
    <row r="${rowIndex + 1}">
      ${row.map((cell, colIndex) => `<c r="${excelColumnName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlCell(cell)}</t></is></c>`).join("")}
    </row>
  `).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.folder("_rels")!.file(".rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl")!.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="报表" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl")!.folder("_rels")!.file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.folder("xl")!.folder("worksheets")!.file("sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`);
  const body = await zip.generateAsync({ type: "uint8array" });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
    },
  });
}

export async function exportReport(request: Request, actor: ActorLike) {
  assertRead(actor, "reports");
  const body = await parseJsonBody(request);
  const type = reportTypeFrom(body.reportType || "receivables");
  const exportScope = text(body.exportScope) || "allFiltered";
  const format = body.format === "xlsx" ? "xlsx" : "csv";
  const query = new URLSearchParams();
  const filters = recordFrom(body.filters);
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, String(value));
  });
  const result = await queryReport(type, query, actor, {
    filters,
    selectedIds: exportScope === "selected" ? stringArrayFrom(body.selectedIds) : [],
    page: exportScope === "currentPage" ? (text(body.page) || 1) : 1,
    pageSize: exportScope === "currentPage" ? (text(body.pageSize) || 20) : 100000,
    sortBy: text(body.sortBy),
    sortDir: text(body.sortDir) || "asc",
    noPagination: exportScope !== "currentPage",
  });
  if (format === "xlsx") return xlsxResponse(REPORT_TYPES[type].filename, result.columns, result.rows);
  return csvResponse(REPORT_TYPES[type].filename, result.columns, result.rows);
}

export async function reportGetHandler(request: Request, type: unknown) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    return Response.json(await queryReport(type, query, actor));
  } catch (error: unknown) {
    return apiError(error, "查询报表失败");
  }
}
