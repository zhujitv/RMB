import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readDomesticLogisticsModuleSource, readTaxRefundModuleSource, readWorkspaceStylesSource } from "./source-helpers.ts";

const moduleSource = readDomesticLogisticsModuleSource();
const taxModuleSource = readTaxRefundModuleSource();
const css = readWorkspaceStylesSource();
const sharedBaseUtils = readFileSync("lib/platform/shared-base-utils.ts", "utf8");
const domesticLogisticsOps = readFileSync("lib/platform/domestic-logistics-ops.ts", "utf8");
const domesticLogisticsApi = readFileSync("lib/platform/domestic-logistics-api.ts", "utf8");
const taxRefundService = readFileSync("lib/platform/tax-refunds.ts", "utf8");
const domesticLogisticsArchiveRoute = readFileSync("app/api/domestic-logistics/archive/route.ts", "utf8");
const exportInvoiceRemarkFormatter = readFileSync("lib/platform/export-invoice-remark.ts", "utf8");
const prismaSchema = readFileSync("prisma/schema.prisma", "utf8");
const reportService = readFileSync("lib/report-service.ts", "utf8");
const manualModule = readFileSync("app/modules/ManualModule.tsx", "utf8");
const sharedConstants = readFileSync("lib/platform/shared-constants.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");

test("domestic logistics list keeps compact accepted columns", () => {
  const tableHead = moduleSource.match(/<th className=\{styles\.orderNoColumn\}>订单号<\/th>[\s\S]*?<th className=\{styles\.detailActionColumn\}>详情<\/th>/)?.[0] || "";
  assert.match(tableHead, /订单号/);
  assert.match(tableHead, /提单号 \/ B\/L No\./);
  assert.match(tableHead, /客户简称/);
  assert.ok(tableHead.indexOf("订单号") < tableHead.indexOf("提单号 / B/L No."));
  assert.ok(tableHead.indexOf("提单号 / B/L No.") < tableHead.indexOf("客户简称"));
  assert.match(tableHead, /<th className=\{styles\.destinationColumn\}>到达地<\/th>/);
  assert.match(tableHead, /<th className=\{styles\.cargoColumn\}>运输货物名称<\/th>/);
  assert.match(tableHead, /<th className=\{styles\.logisticsStatusColumn\}>物流状态<\/th>/);
  assert.match(tableHead, /<th className=\{styles\.logisticsExpenseStatusColumn\}>费用录入状态<\/th>/);
  assert.match(tableHead, /<th className=\{styles\.detailActionColumn\}>详情<\/th>/);
  assert.match(moduleSource, /const tableColSpan = canArchiveDomesticLogistics \? 9 : 8;/);
  assert.match(moduleSource, /<td colSpan=\{tableColSpan\}>/);
  assert.match(moduleSource, /<col className=\{styles\.blNoColumn\} \/>/);
  assert.match(moduleSource, /const destinationText = info\?\.destinationPlace \|\| firstItemValue\(info, "arrivalPlace"\) \|\| "-";/);
  assert.match(moduleSource, /const cargoText = info\?\.cargoDescription \|\| firstItemValue\(info, "cargoName"\) \|\| "-";/);
  assert.match(moduleSource, /<td className=\{styles\.blNoColumn\}>\{row\.blNo \|\| row\.billOfLadingNo \|\| "-"\}<\/td>/);
  assert.match(moduleSource, /<td className=\{styles\.destinationColumn\} title=\{destinationText\}>\{destinationText\}<\/td>/);
  assert.match(moduleSource, /<td className=\{styles\.cargoColumn\} title=\{cargoText\}>\{cargoText\}<\/td>/);
  assert.match(css, /\.logisticsCompactTable \{[\s\S]*min-width: 1108px;[\s\S]*table-layout: fixed;/);
  assert.match(css, /\.logisticsCompactTable th\.blNoColumn,\n\.logisticsCompactTable td\.blNoColumn \{[\s\S]*width: 250px;[\s\S]*min-width: 250px;/);
  assert.match(css, /\.logisticsCompactTable col\.destinationColumn,[\s\S]*width: 110px;[\s\S]*min-width: 110px;/);
  assert.match(css, /\.logisticsCompactTable col\.cargoColumn,[\s\S]*width: 140px;[\s\S]*min-width: 140px;/);
  assert.match(css, /\.logisticsCompactTable col\.logisticsStatusColumn,[\s\S]*width: 90px;[\s\S]*min-width: 90px;[\s\S]*text-align: center;/);
  assert.match(css, /\.logisticsCompactTable col\.logisticsExpenseStatusColumn,[\s\S]*width: 120px;[\s\S]*min-width: 120px;[\s\S]*text-align: center;/);
  assert.match(css, /\.logisticsCompactTable col\.detailActionColumn,[\s\S]*width: 70px;[\s\S]*min-width: 70px;[\s\S]*text-align: center;/);
  assert.match(css, /\.logisticsCompactTable td\.destinationColumn,[\s\S]*\.logisticsCompactTable td\.cargoColumn,[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(css, /\.logisticsCompactTableWrap \{[\s\S]*max-width: 100%;[\s\S]*overflow-x: auto;/);
  assert.match(domesticLogisticsApi, /\{ blNo: \{ contains: keyword, mode: "insensitive" \} \}/);
  assert.match(moduleSource, /DomesticLogisticsExpenseStatusButton/);
  assert.match(moduleSource, /onOpenLogisticsFees/);
  assert.doesNotMatch(moduleSource, /<LogisticsFeesModule/);
});

test("tax refund list keeps bill of lading readable between order and customer", () => {
  const tableHead = taxModuleSource.match(/<th className=\{styles\.taxRefundOrderNoColumn\}>订单号<\/th>[\s\S]*?<th className=\{styles\.taxRefundActionColumn\}>详情<\/th>/)?.[0] || "";
  assert.match(tableHead, /订单号/);
  assert.match(tableHead, /提单号/);
  assert.match(tableHead, /客户简称/);
  assert.ok(tableHead.indexOf("订单号") < tableHead.indexOf("提单号"));
  assert.ok(tableHead.indexOf("提单号") < tableHead.indexOf("客户简称"));
  assert.match(taxModuleSource, /<col className=\{styles\.taxRefundBlNoColumn\} \/>/);
  assert.match(taxModuleSource, /<td colSpan=\{7\}>/);
  assert.match(taxModuleSource, /const billOfLadingNumbers = taxRefundBillOfLadingNumbers\(row\);/);
  assert.match(taxModuleSource, /billOfLadingNumbers\.map\(\(blNo\) => <span key=\{blNo\}>\{blNo\}<\/span>\)/);
  assert.match(taxRefundService, /logisticsBills: \{\s*where: \{ deletedAt: null \}/);
  assert.match(taxRefundService, /billOfLadingNumbers/);
  assert.match(taxRefundService, /billOfLadingNo: \{ contains: keyword, mode: "insensitive" \}/);
  assert.match(css, /\.taxRefundTable\.dataTable \{[\s\S]*min-width: 1020px;[\s\S]*table-layout: fixed;/);
  assert.match(css, /\.taxRefundTable col\.taxRefundOrderNoColumn,[\s\S]*width: 150px;[\s\S]*min-width: 150px;/);
  assert.match(css, /\.taxRefundTable col\.taxRefundBlNoColumn,[\s\S]*width: 280px;[\s\S]*min-width: 240px;/);
  assert.match(css, /\.taxRefundTable col\.taxRefundCustomerColumn,[\s\S]*width: 130px;[\s\S]*min-width: 120px;/);
  assert.match(css, /\.taxRefundTable col\.taxRefundDateColumn,[\s\S]*width: 110px;[\s\S]*min-width: 110px;/);
  assert.match(css, /\.taxRefundTable col\.taxRefundCompletenessColumn,[\s\S]*width: 120px;[\s\S]*min-width: 120px;/);
  assert.match(css, /\.taxRefundTable col\.taxRefundStatusColumn,[\s\S]*width: 160px;[\s\S]*min-width: 160px;/);
  assert.match(css, /\.taxRefundTable col\.taxRefundActionColumn,[\s\S]*width: 70px;[\s\S]*min-width: 70px;/);
  assert.match(css, /\.taxRefundTable th\.taxRefundBlNoColumn,[\s\S]*overflow-wrap: anywhere;/);
  assert.match(css, /\.taxRefundTableWrap \{[\s\S]*overflow-x: auto;/);
});

test("domestic logistics detail keeps per-order fee entry and customs uploads", () => {
  assert.match(moduleSource, /录入费用/);
  assert.match(moduleSource, /CustomsDocumentPanel/);
  assert.match(moduleSource, /集装箱运输明细/);
  assert.match(moduleSource, /集装箱管理/);
  assert.doesNotMatch(moduleSource, /出口发票备注/);
  assert.doesNotMatch(moduleSource, /ExportInvoiceRemarkView/);
});

test("customs document upload cards share one action order", () => {
  const customsPanelSource = moduleSource.match(/function CustomsDocumentPanel[\s\S]*?\n}\n\nfunction UploadProgressInline/)?.[0] || "";
  assert.match(customsPanelSource, /CUSTOMS_DOCUMENT_TYPES\.map/);
  assert.match(customsPanelSource, /const currentDocument = latestUploadedDocument\(matchedDocuments\)/);
  assert.doesNotMatch(customsPanelSource, /if \(documentType\.value === "CUSTOMS_ENTRY_FORM"\)/);
  assert.ok(customsPanelSource.indexOf("UPLOAD_REPLACE_TEXT") < customsPanelSource.indexOf("<PdfPreviewButton"));
  assert.ok(customsPanelSource.indexOf("<PdfPreviewButton") < customsPanelSource.indexOf(">下载</a>"));
  assert.ok(customsPanelSource.indexOf(">下载</a>") < customsPanelSource.indexOf("onClick={() => onDelete(currentDocument)}"));
  assert.match(customsPanelSource, /<PdfPreviewButton documentId=\{currentDocument\.id\} fileName=\{currentDocument\.fileName \|\| ""\} \/>/);
  assert.match(customsPanelSource, /<a className=\{styles\.fileActionButton\}[\s\S]*>下载<\/a>/);
  assert.match(customsPanelSource, /className=\{styles\.fileDangerButton\}[\s\S]*onClick=\{\(\) => onDelete\(currentDocument\)\}/);
  assert.match(css, /\.fileActionButton,\s*\.fileDangerButton \{[\s\S]*height: 34px;[\s\S]*min-width: 64px;[\s\S]*padding: 0 12px;/);
});

test("export invoice remark is structured and hidden from logistics views", () => {
  assert.match(prismaSchema, /exportInvoice\s+Json\?\s+@map\("customs_export_invoice"\)/);
  assert.match(exportInvoiceRemarkFormatter, /export type ExportInvoiceRemark/);
  assert.match(exportInvoiceRemarkFormatter, /containers: ExportInvoiceRemarkContainer\[\]/);
  assert.match(exportInvoiceRemarkFormatter, /formatExportInvoiceRemark/);
  assert.match(domesticLogisticsApi, /exportInvoice: \{ remark: customsExportInvoiceRemark \} as Prisma\.InputJsonValue/);
  assert.match(domesticLogisticsOps, /formatExportInvoiceRemark\(buildExportInvoiceRemarkFromTransportItems\(items\)\)/);
  assert.match(moduleSource, /ALLOWED_LOGISTICS_FIELDS/);
  assert.match(moduleSource, /sanitizeDomesticLogisticsRowsForRender/);
  assert.doesNotMatch(moduleSource, /exportInvoiceRemark|exportInvoiceRemarkText|ExportInvoiceRemarkView|出口发票备注/);
  assert.match(taxModuleSource, /出口发票备注/);
  assert.match(taxModuleSource, /domesticLogisticsInfo\?\.exportInvoice\?\.remark/);
  assert.doesNotMatch(reportService.match(/receivables:\s*\[[\s\S]*?\n  \]/)?.[0] || "", /exportInvoiceRemark|出口发票备注/);
  assert.match(reportService.match(/"tax-refunds":\s*\[[\s\S]*?\n  \]/)?.[0] || "", /exportInvoiceRemark|出口发票备注/);
  assert.doesNotMatch(manualModule, /出口发票备注/);
  for (const cssClass of ["exportInvoiceRemarkBlocks", "exportInvoiceRemarkBlock", "exportInvoiceRemarkBlockGrid"]) {
    assert.match(css, new RegExp(`\\.${cssClass}`));
  }
});

test("domestic logistics list exposes logistics fee entry status from backend", () => {
  assert.match(domesticLogisticsOps, /logisticsBills: \{/);
  assert.match(domesticLogisticsOps, /logisticsExpenses: \{/);
  assert.match(domesticLogisticsOps, /LOGISTICS_EXPENSE_STATUS_PRIORITY/);
  assert.match(domesticLogisticsOps, /domesticLogisticsExpenseStatusSummary/);
  assert.match(domesticLogisticsOps, /domesticLogisticsBillDisplayStatus/);
  assert.match(domesticLogisticsOps, /function domesticLogisticsBillRowsForActor/);
  assert.match(domesticLogisticsOps, /return \(order\.logisticsBills \|\| \[\]\)\.filter/);
  assert.match(domesticLogisticsOps, /logisticsExpenseStatus: expenseStatus\.status/);
  assert.match(domesticLogisticsOps, /auditStatus: expenseStatus\.status/);
  assert.match(domesticLogisticsOps, /invoiceStatus: expenseStatus\.invoiceStatus/);
  assert.match(domesticLogisticsOps, /archiveEligible: domesticLogisticsCanArchiveOrder\(order, actor\)/);
  assert.match(domesticLogisticsOps, /logisticsExpenseBillId: expenseStatus\.billId/);
  assert.doesNotMatch(
    domesticLogisticsOps.match(/function domesticLogisticsExpenseDisplayStatus[\s\S]*?\n}/)?.[0] || "",
    /invoiceStatus|paymentStatus/,
  );
});

test("domestic logistics batch archive uses logistics view archive only", () => {
  assert.match(prismaSchema, /isArchived\s+Boolean\s+@default\(false\)\s+@map\("is_archived"\)/);
  assert.match(prismaSchema, /@@index\(\[isArchived\]\)/);
  assert.match(domesticLogisticsOps, /orderLogisticsArchiveWhereForScope/);
  assert.match(domesticLogisticsOps, /if \(scope === "archive"\) return \{ isArchived: true \};/);
  assert.match(domesticLogisticsOps, /return \{ isArchived: false \};/);
  assert.doesNotMatch(domesticLogisticsOps.match(/function orderLogisticsArchiveWhereForScope[\s\S]*?\n}/)?.[0] || "", /return \{\};/);
  assert.doesNotMatch(moduleSource.match(/const ARCHIVE_SCOPE_OPTIONS = \[[\s\S]*?\];/)?.[0] || "", /全部业务|value: "all"/);
  assert.match(domesticLogisticsApi, /orderLogisticsArchiveWhereForScope\(filters\.businessScope\)/);
  assert.match(domesticLogisticsApi, /archiveDomesticLogisticsOrders/);
  assert.match(domesticLogisticsApi, /domesticLogisticsCanArchiveOrder\(order, currentActor\)/);
  assert.match(domesticLogisticsOps, /domesticLogisticsBillDisplayStatus\(bill\) === "审核通过"/);
  assert.match(domesticLogisticsOps, /domesticLogisticsBillInvoiceStatus\(bill\) === "已上传发票"/);
  assert.match(domesticLogisticsApi, /isArchived: true/);
  assert.doesNotMatch(
    domesticLogisticsApi.match(/export async function archiveDomesticLogisticsOrders[\s\S]*?\n}\n\nasync function/)?.[0] || "",
    /auditStatus:\s*|invoiceStatus:\s*|paymentStatus:\s*/,
  );
  assert.match(domesticLogisticsArchiveRoute, /PATCH/);
  assert.match(domesticLogisticsArchiveRoute, /archiveDomesticLogisticsOrders/);
  assert.match(moduleSource, /批量归档/);
  assert.match(moduleSource, /ARCHIVE_BUTTON_DISABLED_TOOLTIP = "仅允许批量归档审核通过且已上传发票的订单"/);
  assert.match(moduleSource, /domesticLogisticsCanArchive/);
  assert.match(moduleSource, /row\.archiveEligible === true && row\.isArchived !== true/);
  assert.match(moduleSource, /PAYLOAD_ARCHIVE_ENDPOINT/);
  assert.match(moduleSource, /selectedArchivableRows/);
  assert.match(moduleSource, /UiCheckbox/);
});

test("domestic logistics list sorts by unified numeric progress score", () => {
  assert.match(domesticLogisticsOps, /DOMESTIC_LOGISTICS_PROGRESS_WEIGHT/);
  assert.match(domesticLogisticsOps, /const logisticsStatus = domesticLogisticsStatusText\(info\);/);
  assert.match(domesticLogisticsOps, /const feeStatus = domesticLogisticsExpenseStatusSummary\(order\)\.status;/);
  assert.match(domesticLogisticsOps, /Math\.max\(\s*DOMESTIC_LOGISTICS_PROGRESS_WEIGHT\[logisticsStatus\] \?\? 0,\s*DOMESTIC_LOGISTICS_PROGRESS_WEIGHT\[feeStatus\] \?\? 0,\s*\)/);
  assert.match(domesticLogisticsOps, /domesticLogisticsSortRank\(a\) - domesticLogisticsSortRank\(b\)/);
  assert.doesNotMatch(domesticLogisticsOps, /logisticsStatus\.localeCompare|feeStatus\.localeCompare|logisticsExpenseStatus\.localeCompare/);
});

test("domestic logistics transport detail keeps multi-container fields", () => {
  for (const field of ["containerNo", "containerType", "sealNo", "truckPlateNo", "trailerPlateNo", "departurePlace", "arrivalPlace", "cargoName"]) {
    assert.match(moduleSource, new RegExp(field));
  }
  assert.match(moduleSource, /CONTAINER_TYPE_OPTIONS = \["20GP", "40GP", "40HQ", "45HQ"\]/);
  assert.match(moduleSource, /新增集装箱/);
  assert.match(moduleSource, /请选择柜型/);
  assert.match(domesticLogisticsOps, /normalizeDomesticContainerType/);
  assert.match(domesticLogisticsOps, /DOMESTIC_CONTAINER_NO_REQUIRED/);
  assert.match(domesticLogisticsOps, /DOMESTIC_CONTAINER_TYPE_REQUIRED/);
  assert.match(domesticLogisticsOps, /DOMESTIC_CONTAINER_TYPE_INVALID/);
});

test("domestic logistics form controls keep consistent input and select height", () => {
  assert.match(css, /\.transportItemCard input,\n\.transportItemCard select,/);
  assert.match(css, /\.transportItemCard input,\n\.transportItemCard select \{[\s\S]*height: 40px;[\s\S]*min-height: 40px;/);
  assert.match(css, /\.transportItemCard input,\n\.transportItemCard select[\s\S]*border-radius: 8px;[\s\S]*padding: 0 12px;[\s\S]*font-size: 14px;[\s\S]*line-height: 20px;/);
  assert.match(css, /\.transportItemCard select,[\s\S]*\.logisticsItemsRow select \{[\s\S]*appearance: none;/);
  assert.match(css, /\.logisticsTypographyScope \.transportItemCard input,[\s\S]*\.logisticsTypographyScope \.transportItemCard select,[\s\S]*height: 40px;[\s\S]*border-radius: 8px;/);
  assert.match(css, /\.logisticsTypographyScope \.transportItemCard label,[\s\S]*line-height: 20px;/);
});

test("domestic logistics supports bulk warehouse entry mode", () => {
  for (const text of ["BULK_WAREHOUSE", "散货进舱", "散货进舱明细", "进舱编号/唛头", "进舱仓库"]) {
    assert.match(moduleSource, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(sharedConstants, /BULK_WAREHOUSE/);
  assert.match(sharedConstants, /散货进舱/);
  assert.match(domesticLogisticsOps, /进舱日期/);
});

test("domestic logistics no longer exposes ocean auto tracking feature", () => {
  for (const text of ["海运自动跟踪", "每天自动同步一次", "立即同步", "OCEAN_TRACKING_API_URL", "/api/ocean-carriers", "/api/cron/ocean-tracking"]) {
    assert.doesNotMatch(moduleSource, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(vercelConfig, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("shared workspace styles provide full-width expandable detail cards", () => {
  assert.match(css, /\.detailRow td[\s\S]*padding: 0;/);
  assert.match(css, /\.detailCard[\s\S]*border-radius: 12px;/);
  assert.match(css, /\.detailCard[\s\S]*overflow-x: hidden;/);
  assert.match(css, /\.detailGrid[\s\S]*grid-template-columns:/);
});

test("domestic logistics save keeps date and blank-row safeguards", () => {
  assert.match(sharedBaseUtils, /value instanceof Date/);
  assert.match(sharedBaseUtils, /Number\.isNaN\(date\.getTime\(\)\) \? null : date/);
  assert.match(moduleSource, /Object\.values\(item\)\.some\(Boolean\)/);
  assert.match(domesticLogisticsOps, /meaningfulRawItems/);
});
