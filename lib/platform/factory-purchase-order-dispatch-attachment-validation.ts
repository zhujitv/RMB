import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { safeFileName } from "../r2";
import { assertSafePurchaseOrderDispatchXlsx } from "./factory-purchase-order-dispatch-xlsx-validation";
import { codedError } from "./shared-base-utils";

export const PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PURCHASE_ORDER_DISPATCH_ATTACHMENT_ACCEPT = [
  ".pdf",
  ".xlsx",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

const PDF_MIME = "application/pdf";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_ACTIVE_CONTENT_PATTERN = /\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|RichMedia|XFA|AcroForm|SubmitForm|ImportData|GoToR|URI)\b/i;
const PDF_ACTIVE_NAMES = new Set([
  "JavaScript", "JS", "OpenAction", "AA", "Launch", "EmbeddedFile", "EmbeddedFiles", "Filespec", "EF",
  "RichMedia", "XFA", "AcroForm", "SubmitForm", "ImportData", "GoToR", "URI", "Rendition", "Sound", "Movie",
]);
export type ValidatedPurchaseOrderDispatchAttachment = {
  originalFileName: string;
  mimeType: typeof PDF_MIME | typeof XLSX_MIME;
  extension: "pdf" | "xlsx";
  body: Buffer;
  fileSize: number;
};

function declaredMimeAllowed(declared: string, expected: string) {
  return !declared || declared === expected || declared === "application/octet-stream";
}

function assertFileSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw codedError("采购明细附件不能为空", 400, "PURCHASE_ORDER_ATTACHMENT_EMPTY");
  }
  if (size > PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES) {
    throw codedError("采购明细附件大小不能超过 10MB", 413, "PURCHASE_ORDER_ATTACHMENT_TOO_LARGE");
  }
}

function pdfObjectHasActiveContent(value: unknown, visited: Set<object>): boolean {
  if (!value || typeof value !== "object") return false;
  if (visited.has(value)) return false;
  visited.add(value);
  if (value instanceof PDFName) return PDF_ACTIVE_NAMES.has(value.asString().replace(/^\//, ""));
  if (value instanceof PDFStream) return pdfObjectHasActiveContent(value.dict, visited);
  if (value instanceof PDFArray) return value.asArray().some((item) => pdfObjectHasActiveContent(item, visited));
  if (value instanceof PDFDict) {
    return value.entries().some(([key, item]) => (
      PDF_ACTIVE_NAMES.has(key.asString().replace(/^\//, ""))
      || pdfObjectHasActiveContent(item, visited)
    ));
  }
  return false;
}

async function assertSafePdf(body: Buffer) {
  if (body.byteLength < 5 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw codedError("PDF 文件格式错误，请上传有效 PDF", 400, "PURCHASE_ORDER_ATTACHMENT_SIGNATURE_INVALID");
  }
  const source = body.toString("latin1");
  if (PDF_ACTIVE_CONTENT_PATTERN.test(source)) {
    throw codedError(
      "PDF 包含脚本、表单、外部链接或嵌入内容，不能作为采购明细附件",
      400,
      "PURCHASE_ORDER_ATTACHMENT_PDF_ACTIVE_CONTENT",
    );
  }
  const eofAt = source.lastIndexOf("%%EOF");
  if (eofAt < 0 || source.slice(eofAt + 5).trim()) {
    throw codedError("PDF 文件结构异常，请重新导出后上传", 400, "PURCHASE_ORDER_ATTACHMENT_PDF_UNSAFE");
  }
  try {
    const document = await PDFDocument.load(body, { updateMetadata: false });
    const visited = new Set<object>();
    if (document.context.enumerateIndirectObjects().some(([, value]) => pdfObjectHasActiveContent(value, visited))) {
      throw codedError(
        "PDF 包含脚本、表单、外部链接或嵌入内容，不能作为采购明细附件",
        400,
        "PURCHASE_ORDER_ATTACHMENT_PDF_ACTIVE_CONTENT",
      );
    }
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "PURCHASE_ORDER_ATTACHMENT_PDF_ACTIVE_CONTENT") throw error;
    throw codedError("PDF 文件损坏、加密或无法安全读取", 400, "PURCHASE_ORDER_ATTACHMENT_PDF_UNSAFE");
  }
}

export async function readValidatedPurchaseOrderDispatchAttachment(
  candidate: unknown,
): Promise<ValidatedPurchaseOrderDispatchAttachment> {
  if (!(candidate instanceof File)) {
    throw codedError("请选择采购明细附件", 400, "PURCHASE_ORDER_ATTACHMENT_REQUIRED");
  }
  const originalFileName = safeFileName(candidate.name || "采购明细.pdf");
  const lowerName = originalFileName.toLowerCase();
  const extension = lowerName.endsWith(".pdf") ? "pdf" : lowerName.endsWith(".xlsx") ? "xlsx" : "";
  if (!extension) {
    throw codedError("采购明细附件仅支持安全 PDF 或不含宏、外链的 XLSX 文件", 400, "PURCHASE_ORDER_ATTACHMENT_TYPE_NOT_ALLOWED");
  }
  const mimeType = extension === "pdf" ? PDF_MIME : XLSX_MIME;
  if (!declaredMimeAllowed(String(candidate.type || "").toLowerCase(), mimeType)) {
    throw codedError("采购明细附件类型与扩展名不一致", 400, "PURCHASE_ORDER_ATTACHMENT_TYPE_NOT_ALLOWED");
  }
  assertFileSize(Number(candidate.size || 0));
  const body = Buffer.from(await candidate.arrayBuffer());
  assertFileSize(body.byteLength);
  if (extension === "pdf") {
    await assertSafePdf(body);
  } else {
    await assertSafePurchaseOrderDispatchXlsx(body);
  }
  return {
    originalFileName,
    mimeType,
    extension,
    body,
    fileSize: body.byteLength,
  };
}

export function purchaseOrderDispatchAttachmentEmailFileName(poNo: unknown, mimeType: unknown) {
  const extension = String(mimeType || "").toLowerCase() === XLSX_MIME ? "xlsx" : "pdf";
  const safePoNo = safeFileName(String(poNo || "工厂采购单")).replace(/\.(pdf|xlsx)$/i, "").slice(0, 120);
  return `${safePoNo || "工厂采购单"}-采购明细.${extension}`;
}
