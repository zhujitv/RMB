import { getOcrIntegrationSettings } from "./ocr-integration-settings";
import { createTencentOcrClient } from "./tencent-customs-ocr-experiment";
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

export async function recognizeTencentVatInvoice(buffer: Buffer) {
  const encoded = buffer.toString("base64");
  if (Buffer.byteLength(encoded, "utf8") > MAX_TENCENT_BASE64_BYTES) {
    throw codedError("发票编码后超过腾讯云10MB限制，请压缩到约7MB以内。", 413, "TENCENT_VAT_INVOICE_TOO_LARGE");
  }
  const settings = await getOcrIntegrationSettings();
  const client = createTencentOcrClient(settings);
  const isPdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const response = await client.VatInvoiceOCR({
    ImageBase64: encoded,
    IsPdf: isPdf,
    ...(isPdf ? { PdfPageNumber: 1 } : {}),
  });
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
