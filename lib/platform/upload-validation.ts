import { safeFileName } from "../r2";
import { codedError } from "./shared-base-utils";
import { MAX_PAYMENT_VOUCHER_UPLOAD_BYTES, MAX_PDF_UPLOAD_BYTES } from "./shared-constants";

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
type PaymentVoucherUploadFile = ValidatedUploadFile & {
  extension: "jpg" | "jpeg" | "png" | "webp";
};

const PAYMENT_VOUCHER_IMAGE_TYPES: Record<string, PaymentVoucherUploadFile["extension"]> = {
  jpg: "jpg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
};
const PAYMENT_VOUCHER_IMAGE_MIME: Record<PaymentVoucherUploadFile["extension"], string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
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

function paymentVoucherExtension(fileName: string) {
  const extension = String(fileName || "").toLowerCase().split(".").pop() || "";
  return PAYMENT_VOUCHER_IMAGE_TYPES[extension] || null;
}

function paymentVoucherSignatureExtension(body: Buffer): PaymentVoucherUploadFile["extension"] | null {
  if (body.byteLength >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "jpg";
  if (
    body.byteLength >= 8
    && body[0] === 0x89
    && body[1] === 0x50
    && body[2] === 0x4e
    && body[3] === 0x47
    && body[4] === 0x0d
    && body[5] === 0x0a
    && body[6] === 0x1a
    && body[7] === 0x0a
  ) return "png";
  if (
    body.byteLength >= 12
    && body.subarray(0, 4).toString("ascii") === "RIFF"
    && body.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "webp";
  return null;
}

export async function readValidatedPaymentVoucherUploadFile(candidate: unknown, fallbackName = "payment-voucher.jpg"): Promise<PaymentVoucherUploadFile> {
  if (!(candidate instanceof File)) {
    throw codedError("请选择付款凭证图片", 400, "FILE_REQUIRED");
  }
  const originalFileName = safeFileName(candidate.name || fallbackName);
  const extension = paymentVoucherExtension(originalFileName);
  if (!extension) {
    throw codedError("付款凭证仅支持 jpg、jpeg、png、webp 图片", 400, "FILE_TYPE_NOT_ALLOWED");
  }
  const mimeType = candidate.type || PAYMENT_VOUCHER_IMAGE_MIME[extension];
  if (mimeType !== PAYMENT_VOUCHER_IMAGE_MIME[extension]) {
    throw codedError("付款凭证图片类型与文件扩展名不一致", 400, "FILE_TYPE_NOT_ALLOWED");
  }
  if (Number(candidate.size || 0) <= 0) {
    throw codedError("文件不能为空", 400, "FILE_EMPTY");
  }
  if (Number(candidate.size || 0) > MAX_PAYMENT_VOUCHER_UPLOAD_BYTES) {
    throw codedError("文件大小不能超过 10MB", 413, "FILE_TOO_LARGE");
  }
  const body = Buffer.from(await candidate.arrayBuffer());
  if (body.byteLength <= 0) {
    throw codedError("文件不能为空", 400, "FILE_EMPTY");
  }
  if (body.byteLength > MAX_PAYMENT_VOUCHER_UPLOAD_BYTES) {
    throw codedError("文件大小不能超过 10MB", 413, "FILE_TOO_LARGE");
  }
  const signatureExtension = paymentVoucherSignatureExtension(body);
  const signatureMatches = signatureExtension === extension || (signatureExtension === "jpg" && extension === "jpeg");
  if (!signatureExtension || !signatureMatches) {
    throw codedError("付款凭证图片格式错误，请上传有效图片", 400, "FILE_SIGNATURE_INVALID");
  }
  return {
    originalFileName,
    mimeType,
    body,
    fileSize: Number(candidate.size || body.byteLength || 0),
    extension,
  };
}

export async function readValidatedConfirmationEvidenceUploadFile(
  candidate: unknown,
  fallbackName = "confirmation-evidence.pdf",
): Promise<ValidatedUploadFile & { extension: "pdf" | "jpg" | "jpeg" | "png" | "webp" }> {
  if (!(candidate instanceof File)) {
    throw codedError("请选择确认凭证文件", 400, "FILE_REQUIRED");
  }
  const fileName = safeFileName(candidate.name || fallbackName);
  const extension = String(fileName.split(".").pop() || "").toLowerCase();
  if (extension === "pdf") {
    const file = await readValidatedPdfUploadFile(candidate, fallbackName);
    return { ...file, extension: "pdf" };
  }
  if (["jpg", "jpeg", "png", "webp"].includes(extension)) {
    try {
      return await readValidatedPaymentVoucherUploadFile(candidate, fallbackName);
    } catch (error: unknown) {
      const code = String((error as { code?: string } | null)?.code || "");
      if (code === "FILE_TYPE_NOT_ALLOWED" || code === "FILE_SIGNATURE_INVALID") {
        throw codedError("确认凭证图片格式错误，请上传有效的 JPG、JPEG、PNG 或 WebP 文件", 400, code);
      }
      throw error;
    }
  }
  throw codedError(
    "确认凭证仅支持 PDF、JPG、JPEG、PNG 或 WebP 文件",
    400,
    "FILE_TYPE_NOT_ALLOWED",
  );
}
