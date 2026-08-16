import { ocr } from "tencentcloud-sdk-nodejs-ocr";
import { getOcrIntegrationSettings, type AuditRequestLike, type SettingsActor } from "./ocr-integration-settings";
import { assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-background-tasks";
import { codedError, isPlainRecord, redactSensitiveText } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import { readValidatedPdfUploadFile } from "./upload-validation";
import {
  candidateItemsFromTencentTables,
  type TencentCustomsExperimentTable,
} from "./tencent-customs-ocr-table-parser";

const TencentOcrClient = ocr.v20181119.Client;
const TENCENT_OCR_ENDPOINT = "ocr.tencentcloudapi.com";
const MAX_TENCENT_PDF_BASE64_BYTES = 10 * 1024 * 1024;
const MAX_TABLE_PAGES = 5;

type ProviderTableCell = {
  ColTl: number;
  RowTl: number;
  ColBr: number;
  RowBr: number;
  Text: string;
  Type: string;
  Confidence: number;
};

function providerError(error: unknown) {
  const record = isPlainRecord(error) ? error : {};
  const message = redactSensitiveText(
    error instanceof Error ? error.message : String(record.message || "腾讯云 OCR 请求失败"),
    500,
  );
  return {
    code: String(record.code || "TENCENT_OCR_REQUEST_FAILED").slice(0, 160),
    message,
    requestId: String(record.requestId || "").slice(0, 160),
  };
}

function createClient(settings: Awaited<ReturnType<typeof getOcrIntegrationSettings>>) {
  if (!settings.tencentSecretId || !settings.tencentSecretKey) {
    throw codedError("请先保存腾讯云 OCR SecretId 和 SecretKey。", 400, "TENCENT_OCR_CREDENTIAL_REQUIRED");
  }
  return new TencentOcrClient({
    credential: { secretId: settings.tencentSecretId, secretKey: settings.tencentSecretKey },
    region: settings.tencentRegion,
    profile: {
      signMethod: "TC3-HMAC-SHA256",
      language: "zh-CN",
      httpProfile: {
        reqMethod: "POST",
        protocol: "https://",
        endpoint: TENCENT_OCR_ENDPOINT,
        reqTimeout: Math.min(55, Math.max(10, Math.ceil(settings.timeoutMs / 1000))),
      },
    },
  });
}

function tableRows(cells: ProviderTableCell[]) {
  const rowCount = Math.min(200, Math.max(0, ...cells.map((cell) => Number(cell.RowBr) + 1)));
  const columnCount = Math.min(30, Math.max(0, ...cells.map((cell) => Number(cell.ColBr) + 1)));
  const rows = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
  for (const cell of cells) {
    const row = Number(cell.RowTl);
    const column = Number(cell.ColTl);
    if (rows[row]?.[column] !== undefined) rows[row][column] = String(cell.Text || "").trim();
  }
  return rows;
}

function normalizedCells(cells: ProviderTableCell[]) {
  return cells.slice(0, 2_000).map((cell) => ({
    row: Number(cell.RowTl),
    column: Number(cell.ColTl),
    rowEnd: Number(cell.RowBr),
    columnEnd: Number(cell.ColBr),
    text: String(cell.Text || "").trim(),
    confidence: Number.isFinite(Number(cell.Confidence)) ? Number(cell.Confidence) : null,
  }));
}

function tablesFromResponse(response: Awaited<ReturnType<InstanceType<typeof TencentOcrClient>["RecognizeTableAccurateOCR"]>>, page: number) {
  return (response.TableDetections || []).map((table, tableIndex): TencentCustomsExperimentTable => {
    const cells = (table.Cells || []) as ProviderTableCell[];
    return {
      page,
      tableIndex,
      type: Number.isFinite(Number(table.Type)) ? Number(table.Type) : null,
      rows: tableRows(cells),
      cells: normalizedCells(cells),
    };
  });
}

function dedicatedResult(response: Awaited<ReturnType<InstanceType<typeof TencentOcrClient>["RecognizeGeneralInvoice"]>>) {
  const documents = (response.MixedInvoiceItems || []).map((item) => {
    const declaration = item.SingleInvoiceInfos?.CustomsDeclaration;
    return {
      page: Number(item.Page || 1),
      code: String(item.Code || ""),
      type: Number(item.Type ?? -1),
      typeDescription: String(item.TypeDescription || ""),
      title: String(declaration?.Title || ""),
      fields: (declaration?.Content || []).map((field) => ({
        name: String(field.Name || ""),
        value: String(field.Value || ""),
      })),
    };
  });
  return { requestId: String(response.RequestId || ""), totalPages: Number(response.TotalPDFCount || 0), documents };
}

async function recognizeTables(client: InstanceType<typeof TencentOcrClient>, imageBase64: string) {
  const tables: TencentCustomsExperimentTable[] = [];
  const requestIds: string[] = [];
  const warnings: string[] = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_TABLE_PAGES); page += 1) {
    try {
      const response = await client.RecognizeTableAccurateOCR({ ImageBase64: imageBase64, PdfPageNumber: page, UseNewModel: true });
      totalPages = Math.max(1, Number(response.PdfPageSize || totalPages));
      requestIds.push(String(response.RequestId || ""));
      tables.push(...tablesFromResponse(response, page));
    } catch (error) {
      const failure = providerError(error);
      warnings.push(`第${page}页表格识别失败：${failure.message}${failure.requestId ? `（${failure.requestId}）` : ""}`);
      if (page === 1) throw error;
    }
  }
  if (totalPages > MAX_TABLE_PAGES) warnings.push(`PDF共${totalPages}页，本次测试只读取前${MAX_TABLE_PAGES}页表格。`);
  return { totalPages, requestIds: requestIds.filter(Boolean), tables, warnings };
}

export async function runTencentCustomsOcrExperiment(
  request: AuditRequestLike,
  actor: SettingsActor,
  candidate: unknown,
) {
  assertWrite(actor, "settings");
  const file = await readValidatedPdfUploadFile(candidate, "customs-declaration.pdf");
  const imageBase64 = file.body.toString("base64");
  if (Buffer.byteLength(imageBase64, "utf8") > MAX_TENCENT_PDF_BASE64_BYTES) {
    throw codedError("PDF编码后超过腾讯云10MB限制，请压缩到约7MB以内再测试。", 413, "TENCENT_OCR_FILE_TOO_LARGE");
  }
  const settings = await getOcrIntegrationSettings();
  const client = createClient(settings);
  const [dedicatedSettled, tableSettled] = await Promise.allSettled([
    client.RecognizeGeneralInvoice({
      ImageBase64: imageBase64,
      Types: [22],
      EnableOther: false,
      EnablePdf: true,
      EnableMultiplePage: true,
      EnableCutImage: false,
      EnableItemPolygon: true,
    }),
    recognizeTables(client, imageBase64),
  ]);
  if (dedicatedSettled.status === "rejected" && tableSettled.status === "rejected") {
    const dedicatedFailure = providerError(dedicatedSettled.reason);
    const tableFailure = providerError(tableSettled.reason);
    const error = codedError(
      `腾讯云报关单专用识别和表格识别均失败：${dedicatedFailure.message}；${tableFailure.message}`,
      502,
      "TENCENT_CUSTOMS_OCR_EXPERIMENT_FAILED",
    );
    error.details = { dedicated: dedicatedFailure, table: tableFailure };
    throw error;
  }
  const dedicated = dedicatedSettled.status === "fulfilled" ? dedicatedResult(dedicatedSettled.value) : null;
  const table = tableSettled.status === "fulfilled" ? tableSettled.value : { totalPages: 0, requestIds: [], tables: [], warnings: [] };
  const warnings = [...table.warnings];
  if (dedicatedSettled.status === "rejected") warnings.unshift(`报关单专用识别失败：${providerError(dedicatedSettled.reason).message}`);
  if (tableSettled.status === "rejected") warnings.unshift(`表格识别失败：${providerError(tableSettled.reason).message}`);
  const items = candidateItemsFromTencentTables(table.tables);
  if (!items.length) warnings.push("未从表格结果中定位到完整商品表头，请查看原始表格并人工判断。");
  const result = {
    provider: "TENCENT_CLOUD",
    experimental: true,
    savedToBusinessData: false,
    file: { fileName: file.originalFileName, fileSize: file.fileSize },
    dedicated,
    table: { totalPages: table.totalPages, requestIds: table.requestIds, tables: table.tables },
    candidateItems: items,
    warnings,
  };
  await runNonCriticalTask("腾讯云报关单OCR测试日志写入", () => writeAudit(
    request,
    actor,
    "测试腾讯云报关单OCR",
    "ocr_experiments",
    dedicated?.requestId || table.requestIds[0] || "tencent-customs",
    null,
    {
      provider: result.provider,
      fileName: file.originalFileName,
      fileSize: file.fileSize,
      dedicatedRequestId: dedicated?.requestId || "",
      tableRequestIds: table.requestIds,
      tableCount: table.tables.length,
      candidateItemCount: items.length,
      warningCount: warnings.length,
    },
  ));
  return result;
}
