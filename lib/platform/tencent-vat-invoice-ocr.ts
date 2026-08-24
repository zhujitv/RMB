import { getOcrIntegrationSettings } from "./ocr-integration-settings";
import { createTencentOcrClient } from "./tencent-customs-ocr-experiment";
import type { OcrRecognitionResult } from "./ocr-integration-config";
import { codedError, isPlainRecord } from "./shared-base-utils";

const MAX_TENCENT_BASE64_BYTES = 10 * 1024 * 1024;

type InvoiceInfo = { Name?: string | null; Value?: string | null };
type InvoiceItem = {
  LineNo?: string | null;
  Name?: string | null;
  Spec?: string | null;
  Unit?: string | null;
  Quantity?: string | null;
  UnitPrice?: string | null;
  AmountWithoutTax?: string | null;
  TaxRate?: string | null;
  TaxAmount?: string | null;
  TaxClassifyCode?: string | null;
};

function text(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function infoMap(rows: InvoiceInfo[] = []) {
  return Object.fromEntries(rows.map((row) => [text(row.Name), text(row.Value)]).filter(([key]) => key));
}

function field(fields: Record<string, string>, ...names: string[]) {
  return names.map((name) => fields[name]).find(Boolean) || "";
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason || codedError("腾讯云发票 OCR 已取消。", 499, "TENCENT_VAT_INVOICE_ABORTED");
}

export async function recognizeTencentVatInvoice(
  buffer: Buffer,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  throwIfAborted(options.signal);
  const encoded = buffer.toString("base64");
  if (Buffer.byteLength(encoded, "utf8") > MAX_TENCENT_BASE64_BYTES) {
    throw codedError("发票编码后超过腾讯云10MB限制，请压缩到约7MB以内。", 413, "TENCENT_VAT_INVOICE_TOO_LARGE");
  }
  const loadedSettings = await getOcrIntegrationSettings();
  const requestedTimeoutMs = Math.max(1000, Math.trunc(Number(options.timeoutMs) || loadedSettings.timeoutMs));
  const settings = { ...loadedSettings, timeoutMs: Math.min(loadedSettings.timeoutMs, requestedTimeoutMs) };
  const client = createTencentOcrClient(settings);
  const isPdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const response = await client.VatInvoiceOCR({
    ImageBase64: encoded,
    IsPdf: isPdf,
    ...(isPdf ? { PdfPageNumber: 1 } : {}),
  });
  throwIfAborted(options.signal);
  const raw = isPlainRecord(response) ? response : {};
  const infos = Array.isArray(raw.VatInvoiceInfos) ? raw.VatInvoiceInfos as InvoiceInfo[] : [];
  const items = Array.isArray(raw.Items) ? raw.Items as InvoiceItem[] : [];
  const fields = infoMap(infos);
  return {
    provider: "TENCENT_CLOUD",
    apiName: "VatInvoiceOCR",
    requestId: text(raw.RequestId),
    pageCount: Number(raw.PdfPageSize || 0),
    header: {
      invoiceName: field(fields, "发票名称"),
      invoiceCode: field(fields, "发票代码", "打印发票代码"),
      invoiceNo: field(fields, "发票号码", "打印发票号码"),
      invoiceDate: field(fields, "开票日期"),
      sellerName: field(fields, "销售方名称"),
      sellerTaxNo: field(fields, "销售方识别号", "销售方纳税人识别号"),
      buyerName: field(fields, "购买方名称"),
      buyerTaxNo: field(fields, "购买方识别号", "购买方纳税人识别号"),
      amountWithoutTax: field(fields, "合计金额"),
      taxAmount: field(fields, "合计税额"),
      amountWithTax: field(fields, "小写金额", "价税合计(小写)", "价税合计（小写）"),
      checkCode: field(fields, "校验码"),
    },
    items: items.map((item, index) => ({
      lineNo: text(item.LineNo) || String(index + 1),
      name: text(item.Name),
      spec: text(item.Spec),
      unit: text(item.Unit),
      quantity: text(item.Quantity),
      unitPrice: text(item.UnitPrice),
      amountWithoutTax: text(item.AmountWithoutTax),
      taxRate: text(item.TaxRate),
      taxAmount: text(item.TaxAmount),
      taxClassifyCode: text(item.TaxClassifyCode),
    })),
    rawJson: JSON.parse(JSON.stringify(response)),
  };
}

export type TencentVatInvoiceResult = Awaited<ReturnType<typeof recognizeTencentVatInvoice>>;

function uniqueItemValues(items: TencentVatInvoiceResult["items"], key: keyof TencentVatInvoiceResult["items"][number]) {
  return [...new Set(items.map((item) => text(item[key])).filter(Boolean))].join("；");
}

function integrationText(invoice: TencentVatInvoiceResult) {
  const header = invoice.header;
  const lines = [
    `发票名称：${header.invoiceName}`,
    `发票代码：${header.invoiceCode}`,
    `发票号码：${header.invoiceNo}`,
    `开票日期：${header.invoiceDate}`,
    `购买方名称：${header.buyerName}`,
    `购买方纳税人识别号：${header.buyerTaxNo}`,
    `销售方名称：${header.sellerName}`,
    `销售方纳税人识别号：${header.sellerTaxNo}`,
    `合计金额：${header.amountWithoutTax}`,
    `合计税额：${header.taxAmount}`,
    `价税合计（小写）：${header.amountWithTax}`,
  ];
  for (const item of invoice.items) {
    lines.push(
      `货物或应税劳务、服务名称：${item.name} 规格型号：${item.spec} 单位：${item.unit} 数量：${item.quantity} 单价：${item.unitPrice} 金额：${item.amountWithoutTax} 税率：${item.taxRate} 税额：${item.taxAmount}`,
    );
  }
  return lines.filter((line) => !line.endsWith("：")).join("\n");
}

export function tencentVatInvoiceIntegrationResult(invoice: TencentVatInvoiceResult): OcrRecognitionResult {
  const extractedFields = {
    invoiceNo: invoice.header.invoiceNo,
    invoiceDate: invoice.header.invoiceDate,
    amountWithTax: invoice.header.amountWithTax,
    amountWithoutTax: invoice.header.amountWithoutTax,
    taxAmount: invoice.header.taxAmount,
    seller: invoice.header.sellerName,
    sellerTaxNo: invoice.header.sellerTaxNo,
    buyer: invoice.header.buyerName,
    buyerTaxNo: invoice.header.buyerTaxNo,
    productName: uniqueItemValues(invoice.items, "name"),
    specModel: uniqueItemValues(invoice.items, "spec"),
    unit: uniqueItemValues(invoice.items, "unit"),
    quantity: uniqueItemValues(invoice.items, "quantity"),
    unitPrice: uniqueItemValues(invoice.items, "unitPrice"),
    taxRate: uniqueItemValues(invoice.items, "taxRate"),
  };
  return {
    text: integrationText(invoice),
    source: "TENCENT_VAT_INVOICE_OCR",
    provider: invoice.provider,
    apiName: invoice.apiName,
    rawJson: invoice.rawJson,
    extractedFields,
    parsedJson: extractedFields,
    parser: "VAT_INVOICE",
    diagnostics: {
      requestId: invoice.requestId,
      pageCount: invoice.pageCount,
      itemCount: invoice.items.length,
    },
  };
}

export async function recognizeTencentVatInvoiceForIntegration(
  buffer: Buffer,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<OcrRecognitionResult> {
  return tencentVatInvoiceIntegrationResult(await recognizeTencentVatInvoice(buffer, options));
}
