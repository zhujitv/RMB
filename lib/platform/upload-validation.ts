import { safeFileName } from "../r2";
import { codedError } from "./shared-base-utils";
import { MAX_PDF_UPLOAD_BYTES } from "./shared-constants";

type ValidatedUploadFile = {
  originalFileName: string;
  mimeType: string;
  body: Buffer;
  fileSize: number;
};

type PdfUploadCandidate = {
  file: File;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
};

type InvoiceMimeType = "application/pdf" | "image/jpeg" | "image/png";

const DISALLOWED_PDF_ACTIVE_CONTENT_PATTERNS = [
  /\/JavaScript\b/i,
  /\/JS\b/i,
  /\/OpenAction\b/i,
  /\/AA\b/i,
  /\/Launch\b/i,
  /\/EmbeddedFile\b/i,
  /\/RichMedia\b/i,
  /\/SubmitForm\b/i,
  /\/ImportData\b/i,
  /\/GoToE\b/i,
  /\/XFA\b/i,
];

function assertPdfDoesNotContainActiveContent(body: Buffer) {
  const text = body.toString("latin1");
  if (DISALLOWED_PDF_ACTIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    throw codedError("PDF包含不允许的主动内容，请上传普通PDF文件。", 400, "PDF_ACTIVE_CONTENT_NOT_ALLOWED");
  }
}

export function assertPdfUploadFileCandidate(candidate: unknown): PdfUploadCandidate {
  if (!(candidate instanceof File)) {
    throw codedError("请选择 PDF 文件", 400, "FILE_REQUIRED");
  }
  const fileName = safeFileName(candidate.name || "document.pdf");
  const mimeType = candidate.type || "application/pdf";
  if (!fileName.toLowerCase().endsWith(".pdf") || mimeType !== "application/pdf") {
    throw codedError("文件类型不允许，只能上传 PDF 文件", 400, "FILE_TYPE_NOT_ALLOWED");
  }
  if (Number(candidate.size || 0) > MAX_PDF_UPLOAD_BYTES) {
    throw codedError("文件超过大小限制，最大支持 20MB PDF。", 413, "FILE_TOO_LARGE");
  }
  return { file: candidate, originalFileName: fileName, mimeType, fileSize: Number(candidate.size || 0) };
}

export async function readValidatedPdfUploadFile(candidate: unknown, fallbackName = "document.pdf"): Promise<ValidatedUploadFile> {
  const { file, originalFileName, mimeType } = assertPdfUploadFileCandidate(candidate);
  const arrayBuffer = await file.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (body.byteLength > MAX_PDF_UPLOAD_BYTES) {
    throw codedError("文件超过大小限制，最大支持 20MB PDF。", 413, "FILE_TOO_LARGE");
  }
  if (body.byteLength < 5 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw codedError("文件格式错误，只能上传有效 PDF 文件", 400, "FILE_SIGNATURE_INVALID");
  }
  const pdfTail = body.subarray(Math.max(0, body.byteLength - 2048)).toString("latin1");
  if (!pdfTail.includes("%%EOF")) {
    throw codedError("文件格式错误，只能上传完整 PDF 文件", 400, "FILE_SIGNATURE_INVALID");
  }
  assertPdfDoesNotContainActiveContent(body);
  return {
    originalFileName: originalFileName || safeFileName(fallbackName),
    mimeType,
    body,
    fileSize: Number(file.size || body.byteLength || 0),
  };
}

const INVOICE_IMAGE_SIGNATURES: Record<Exclude<InvoiceMimeType, "application/pdf">, (body: Buffer) => boolean> = {
  "image/png": (body: Buffer) => body.length >= 8
    && body[0] === 0x89
    && body[1] === 0x50
    && body[2] === 0x4e
    && body[3] === 0x47
    && body[4] === 0x0d
    && body[5] === 0x0a
    && body[6] === 0x1a
    && body[7] === 0x0a,
  "image/jpeg": (body: Buffer) => body.length >= 4
    && body[0] === 0xff
    && body[1] === 0xd8
    && body[2] === 0xff,
};

const INVOICE_UPLOAD_EXTENSIONS = new Map<InvoiceMimeType, string>([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
]);

function isInvoiceMimeType(value: string): value is InvoiceMimeType {
  return INVOICE_UPLOAD_EXTENSIONS.has(value as InvoiceMimeType);
}

export async function readValidatedInvoiceUploadFile(candidate: unknown, fallbackName = "invoice.pdf"): Promise<ValidatedUploadFile> {
  if (!(candidate instanceof File)) {
    throw codedError("请选择发票文件", 400, "FILE_REQUIRED");
  }
  const safeOriginalName = safeFileName(candidate.name || fallbackName);
  const lowerName = safeOriginalName.toLowerCase();
  const mimeType = String(candidate.type || "").toLowerCase() || invoiceMimeTypeFromName(lowerName);
  const expectedExtension = isInvoiceMimeType(mimeType) ? INVOICE_UPLOAD_EXTENSIONS.get(mimeType) : "";
  if (!expectedExtension || ![".pdf", ".jpg", ".jpeg", ".png"].some((suffix) => lowerName.endsWith(suffix))) {
    throw codedError("文件类型不允许，只能上传 PDF、JPG 或 PNG 发票文件", 400, "FILE_TYPE_NOT_ALLOWED");
  }
  if (Number(candidate.size || 0) > MAX_PDF_UPLOAD_BYTES) {
    throw codedError("文件超过大小限制，最大支持 20MB。", 413, "FILE_TOO_LARGE");
  }
  if (mimeType === "application/pdf") return readValidatedPdfUploadFile(candidate, fallbackName);

  const arrayBuffer = await candidate.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (body.byteLength > MAX_PDF_UPLOAD_BYTES) {
    throw codedError("文件超过大小限制，最大支持 20MB。", 413, "FILE_TOO_LARGE");
  }
  const isValidImage = mimeType === "image/jpeg" || mimeType === "image/png"
    ? INVOICE_IMAGE_SIGNATURES[mimeType](body)
    : false;
  if (!isValidImage) {
    throw codedError("文件格式错误，只能上传有效 JPG 或 PNG 图片", 400, "FILE_SIGNATURE_INVALID");
  }
  return {
    originalFileName: safeOriginalName || safeFileName(fallbackName),
    mimeType,
    body,
    fileSize: Number(candidate.size || body.byteLength || 0),
  };
}

function invoiceMimeTypeFromName(fileName: string) {
  if (fileName.endsWith(".pdf")) return "application/pdf";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
  if (fileName.endsWith(".png")) return "image/png";
  return "";
}
