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

export function assertPdfUploadFileCandidate(candidate: unknown): PdfUploadCandidate {
  if (!(candidate instanceof File)) {
    throw codedError("请选择 PDF 文件", 400, "FILE_REQUIRED");
  }
  const fileName = safeFileName(candidate.name || "document.pdf");
  const mimeType = candidate.type || "application/pdf";
  if (!fileName.toLowerCase().endsWith(".pdf") || mimeType !== "application/pdf") {
    throw codedError("文件类型不允许，只能上传 PDF 文件", 400, "FILE_TYPE_NOT_ALLOWED");
  }
  if (Number(candidate.size || 0) <= 0) {
    throw codedError("文件不能为空", 400, "FILE_EMPTY");
  }
  if (Number(candidate.size || 0) > MAX_PDF_UPLOAD_BYTES) {
    throw codedError("文件大小不能超过 10MB", 413, "FILE_TOO_LARGE");
  }
  return { file: candidate, originalFileName: fileName, mimeType, fileSize: Number(candidate.size || 0) };
}

export async function readValidatedPdfUploadFile(candidate: unknown, fallbackName = "document.pdf"): Promise<ValidatedUploadFile> {
  const { file, originalFileName, mimeType } = assertPdfUploadFileCandidate(candidate);
  const arrayBuffer = await file.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (body.byteLength <= 0) {
    throw codedError("文件不能为空", 400, "FILE_EMPTY");
  }
  if (body.byteLength > MAX_PDF_UPLOAD_BYTES) {
    throw codedError("文件大小不能超过 10MB", 413, "FILE_TOO_LARGE");
  }
  if (body.byteLength < 5 || body.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw codedError("文件格式错误，只能上传有效 PDF 文件", 400, "FILE_SIGNATURE_INVALID");
  }
  return {
    originalFileName: originalFileName || safeFileName(fallbackName),
    mimeType,
    body,
    fileSize: Number(file.size || body.byteLength || 0),
  };
}

export async function readValidatedInvoiceUploadFile(candidate: unknown, fallbackName = "invoice.pdf"): Promise<ValidatedUploadFile> {
  if (!(candidate instanceof File)) {
    throw codedError("请选择发票文件", 400, "FILE_REQUIRED");
  }
  return readValidatedPdfUploadFile(candidate, fallbackName);
}
