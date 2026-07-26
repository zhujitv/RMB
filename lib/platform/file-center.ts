import { deleteR2Object, uploadToR2 } from "../r2";
import {
  readValidatedInvoiceUploadFile,
  readValidatedPaymentVoucherUploadFile,
  readValidatedPdfUploadFile,
} from "./upload-validation";

type UploadedByLike = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
} | null | undefined;

export type ManagedUploadValidation = "pdf" | "invoicePdf" | "paymentVoucherImage";

export type ManagedValidatedFile = {
  originalFileName: string;
  mimeType: string;
  body: Buffer;
  fileSize: number;
  extension?: string;
};

export type ManagedStoredFile = {
  fileUrl: string | null;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  bucket: string;
  uploadedAt: Date;
};

export type ManagedFileBinding = {
  orderId?: string | null;
  costId?: string | null;
  supplierId?: string | null;
  logisticsExpenseId?: string | null;
  supplierDocumentRequestId?: string | null;
  taxRefundDocumentType?: string | null;
  orderDocumentId?: string | null;
  relatedModule?: string | null;
};

export type ManagedFileMetadata = {
  fileUrl: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: unknown;
  uploadedBy: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  binding: ManagedFileBinding;
};

export const MANAGED_FILE_KINDS = {
  ORDER_DOCUMENT: "order-document",
  PAYMENT_VOUCHER: "payment-voucher",
  SUPPLIER_REQUEST_TEMPLATE: "supplier-request-template",
} as const;

export function normalizeManagedFileKind(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  if (["order-document", "order_document", "document", "tax-refund-document", "logistics-invoice", "supplier-document"].includes(text)) {
    return MANAGED_FILE_KINDS.ORDER_DOCUMENT;
  }
  if (["payment-voucher", "payment_voucher", "voucher"].includes(text)) return MANAGED_FILE_KINDS.PAYMENT_VOUCHER;
  if (["supplier-request-template", "supplier_template", "supplier-template"].includes(text)) return MANAGED_FILE_KINDS.SUPPLIER_REQUEST_TEMPLATE;
  return "";
}

export function managedFileDownloadPath(kind: string, id: string) {
  return `/api/files/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/download`;
}

export function managedFilePreviewPath(kind: string, id: string) {
  return `/api/files/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/preview`;
}

export async function readManagedUploadFile(
  candidate: unknown,
  validation: ManagedUploadValidation,
  fallbackName = "document.pdf",
): Promise<ManagedValidatedFile> {
  if (validation === "invoicePdf") return readValidatedInvoiceUploadFile(candidate, fallbackName);
  if (validation === "paymentVoucherImage") return readValidatedPaymentVoucherUploadFile(candidate, fallbackName);
  return readValidatedPdfUploadFile(candidate, fallbackName);
}

export async function uploadManagedFileToStorage({
  file,
  storageKey,
  fileName,
}: {
  file: ManagedValidatedFile;
  storageKey: string;
  fileName?: string;
}): Promise<ManagedStoredFile> {
  const stored = await uploadToR2({ key: storageKey, body: file.body, contentType: file.mimeType });
  return {
    fileUrl: null,
    fileName: fileName || file.originalFileName,
    originalFileName: file.originalFileName,
    mimeType: file.mimeType,
    fileSize: file.fileSize,
    storageKey: stored.key,
    bucket: stored.bucket,
    uploadedAt: new Date(),
  };
}

export async function deleteManagedStoredFile(storageKey: string) {
  if (!storageKey) return;
  await deleteR2Object(storageKey);
}

function cleanDownloadFileName(fileName = "document") {
  return String(fileName || "document")
    .replace(/[\u0000-\u001f\u007f\r\n"]/g, "_")
    .replace(/[\\/:*?<>|;]+/g, "_")
    .trim() || "document";
}

export function managedContentDispositionHeader(disposition = "inline", fileName = "document") {
  const normalizedDisposition = disposition === "attachment" ? "attachment" : "inline";
  const safeFileName = cleanDownloadFileName(fileName);
  const asciiFileName = safeFileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\r\n"\\/:*?<>|;]+/g, "_")
    .trim() || "document";
  return `${normalizedDisposition}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`;
}

export function managedFileStreamHeaders({
  bodyLength,
  mimeType,
  fileName,
  disposition = "inline",
}: {
  bodyLength?: number;
  mimeType?: string | null;
  fileName?: string | null;
  disposition?: "inline" | "attachment";
}) {
  return {
    "Content-Type": mimeType || "application/octet-stream",
    ...(typeof bodyLength === "number" ? { "Content-Length": String(bodyLength) } : {}),
    "Content-Disposition": managedContentDispositionHeader(disposition, fileName || "document"),
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };
}

export function managedPreviewableMimeType(mimeType: unknown) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized === "application/pdf") return "pdf";
  if (["image/jpeg", "image/png", "image/webp"].includes(normalized)) return "image";
  return "";
}

export function isManagedPreviewableMimeType(mimeType: unknown) {
  return Boolean(managedPreviewableMimeType(mimeType));
}

export function managedFileMetadata(input: {
  fileUrl?: string | null;
  fileName?: string | null;
  originalFileName?: string | null;
  originalFilename?: string | null;
  originalName?: string | null;
  displayFileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  storageKey?: string | null;
  bucket?: string | null;
  r2Bucket?: string | null;
  uploadedAt?: unknown;
  uploadedBy?: UploadedByLike;
  binding?: ManagedFileBinding;
} = {}): ManagedFileMetadata {
  const uploadedBy = input.uploadedBy
    ? {
        id: String(input.uploadedBy.id || ""),
        name: String(input.uploadedBy.name || ""),
        email: String(input.uploadedBy.email || ""),
        role: String(input.uploadedBy.role || ""),
      }
    : null;
  const fileName = String(
    input.displayFileName
    || input.fileName
    || input.originalFileName
    || input.originalFilename
    || input.originalName
    || "文件",
  );
  return {
    fileUrl: String(input.fileUrl || ""),
    fileName,
    originalFileName: String(input.originalFileName || input.originalFilename || input.originalName || ""),
    mimeType: String(input.mimeType || ""),
    fileSize: Number(input.fileSize || 0),
    uploadedAt: input.uploadedAt || null,
    uploadedBy,
    binding: input.binding || {},
  };
}
