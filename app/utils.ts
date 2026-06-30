import type { PermissionSnapshot, User } from "./types";

type CustomerNameLike = {
  customerShortName?: string | null;
  customerName?: string | null;
  customerFullName?: string | null;
  shortName?: string | null;
  name?: string | null;
  fullName?: string | null;
};

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function initials(name = "") {
  const trimmed = name.trim();
  if (!trimmed) return "NW";
  return trimmed.slice(0, 1).toUpperCase();
}

export function canWritePermission(
  user: User,
  permissions: PermissionSnapshot | undefined,
  area: string,
  fallbackRoles: string[] = [],
) {
  if (user.role === "管理员") return true;
  if (permissions?.writes && Object.prototype.hasOwnProperty.call(permissions.writes, area)) {
    return Boolean(permissions.writes[area]);
  }
  if (Array.isArray(permissions?.writeKeys) && permissions.writeKeys.length) {
    return permissions.writeKeys.includes(area);
  }
  return fallbackRoles.includes(user.role);
}

export function canReadPermission(
  user: User,
  permissions: PermissionSnapshot | undefined,
  area: string,
  fallbackRoles: string[] = [],
) {
  if (user.role === "管理员") return true;
  if (permissions?.reads && Object.prototype.hasOwnProperty.call(permissions.reads, area)) {
    return Boolean(permissions.reads[area]);
  }
  if (Array.isArray(permissions?.readKeys) && permissions.readKeys.length) {
    return permissions.readKeys.includes(area);
  }
  return fallbackRoles.includes(user.role);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const PDF_UPLOAD_ACCEPT = ".pdf";
export const PDF_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_UPLOAD_MAX_SIZE_LABEL = "10MB";
export const PAYMENT_VOUCHER_UPLOAD_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
export const PAYMENT_VOUCHER_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export function isPdfFile(file: File) {
  return file.name.toLowerCase().endsWith(".pdf") && file.type === "application/pdf";
}

export function validatePdfUploadFile(file: File | null) {
  if (!file) return "请选择 PDF 文件";
  if (!isPdfFile(file)) return "仅支持PDF文件";
  if (file.size > PDF_UPLOAD_MAX_BYTES) return "文件大小不能超过 10MB";
  return "";
}

export function validatePaymentVoucherUploadFile(file: File | null) {
  if (!file) return "请选择付款凭证图片";
  const lowerName = file.name.toLowerCase();
  const allowedName = [".jpg", ".jpeg", ".png", ".webp"].some((extension) => lowerName.endsWith(extension));
  const allowedType = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (!allowedName || !allowedType) return "付款凭证仅支持 jpg、jpeg、png、webp 图片";
  if (file.size > PAYMENT_VOUCHER_UPLOAD_MAX_BYTES) return "文件大小不能超过 10MB";
  return "";
}

export function uploadFormDataWithProgress<T = Record<string, unknown>>(
  url: string,
  formData: FormData,
  onProgress: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const nextProgress = Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 100)));
      onProgress(nextProgress);
    };
    xhr.onload = () => {
      const result = parseJsonResponse(xhr.responseText) as T & {
        success?: boolean;
        message?: string;
        error?: string;
      };
      if (xhr.status < 200 || xhr.status >= 300 || result.success === false) {
        reject(new Error(result.message || result.error || "文件上传失败"));
        return;
      }
      onProgress(100);
      resolve(result);
    };
    xhr.onerror = () => reject(new Error("上传失败，请重试"));
    xhr.onabort = () => reject(new Error("上传已取消，请重试"));
    xhr.send(formData);
  });
}

function parseJsonResponse(text: string) {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

export function customerDisplayName(record?: CustomerNameLike | null) {
  return record?.customerShortName
    || record?.shortName
    || record?.customerName
    || record?.name
    || record?.customerFullName
    || record?.fullName
    || "-";
}

export function customerLegalName(record?: CustomerNameLike | null) {
  return record?.customerFullName
    || record?.fullName
    || record?.customerName
    || record?.name
    || record?.customerShortName
    || record?.shortName
    || "-";
}
