import { createHash } from "node:crypto";
import { safeFileName } from "../r2.ts";

type DocumentIntegrityError = Error & { status?: number; code?: string; expose?: boolean };

function documentIntegrityError(message: string, status: number, code: string): DocumentIntegrityError {
  const error: DocumentIntegrityError = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const QUOTATION_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

export function quotationDocumentSha256(body: Buffer | Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

function storageSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw documentIntegrityError(`${label}包含无效字符`, 500, "QUOTATION_DOCUMENT_PATH_INVALID");
  }
  return value;
}

export function quotationDocumentStorageKey(
  quotationId: string,
  versionId: string,
  sha256: string,
  fileName: string,
) {
  if (!SHA256_PATTERN.test(sha256)) {
    throw documentIntegrityError("形式发票摘要格式错误", 500, "QUOTATION_DOCUMENT_HASH_INVALID");
  }
  const quotation = storageSegment(quotationId, "报价 ID");
  const version = storageSegment(versionId, "版本 ID");
  return `sales-quotations/${quotation}/versions/${version}/${sha256}/${safeFileName(fileName)}`;
}

export function assertQuotationDocumentBody(
  value: Buffer | Uint8Array,
  expectedSha256 = "",
  expectedSize: number | null = null,
) {
  const body = Buffer.from(value);
  if (body.byteLength < 5 || body.byteLength > QUOTATION_DOCUMENT_MAX_BYTES) {
    throw documentIntegrityError("形式发票文件大小异常", 413, "QUOTATION_DOCUMENT_SIZE_INVALID");
  }
  if (expectedSize !== null && (!Number.isSafeInteger(expectedSize) || expectedSize !== body.byteLength)) {
    throw documentIntegrityError("形式发票文件大小校验失败", 409, "QUOTATION_DOCUMENT_SIZE_MISMATCH");
  }
  const hasPdfHeader = body.subarray(0, 5).toString("ascii") === "%PDF-";
  const hasPdfFooter = body.subarray(-1024).includes(Buffer.from("%%EOF"));
  if (!hasPdfHeader || !hasPdfFooter) {
    throw documentIntegrityError("形式发票文件格式校验失败", 409, "QUOTATION_DOCUMENT_PDF_INVALID");
  }
  const actualSha256 = quotationDocumentSha256(body);
  if (expectedSha256 && (!SHA256_PATTERN.test(expectedSha256) || actualSha256 !== expectedSha256)) {
    throw documentIntegrityError("形式发票文件完整性校验失败", 409, "QUOTATION_DOCUMENT_HASH_MISMATCH");
  }
  return actualSha256;
}

export function validQuotationDocumentSha256(value: unknown): value is string {
  return SHA256_PATTERN.test(String(value || ""));
}
