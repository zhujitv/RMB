import type { ReactNode } from "react";

export type PdfPreviewDocument = {
  id: string;
  fileName?: string;
  displayFileName?: string;
  downloadFileName?: string;
  originalFileName?: string;
  originalFilename?: string;
  originalName?: string;
};

export type PdfPreviewMetadataResponse = {
  success?: boolean;
  document?: PdfPreviewDocument;
  file?: PdfPreviewDocument & { mimeType?: string; previewKind?: string };
  error?: string;
  message?: string;
};

export type PdfPreviewState = "checking" | "ready" | "failed";
export type PreviewContentKind = "pdf" | "image";
export type FilePreviewMetaItem = { label: string; value: ReactNode };

export function pdfPreviewStatusMessage(response: Response) {
  const code = response.headers.get("X-Preview-Error-Code") || "";
  if (response.status === 403) return "权限不足，无法预览该文件。";
  if (response.status === 404) return "文件不存在或已删除。";
  if (code === "R2_OBJECT_NOT_FOUND") return "文件地址失效，请重新上传或联系管理员。";
  if (code === "INVALID_FILE_TYPE") return "当前文件类型不支持在线预览。";
  if (code === "STORAGE_NETWORK_TIMEOUT") return "文件存储读取超时，请稍后重试。";
  return "文件暂时无法预览，请下载查看。";
}

export function pdfPreviewFileName(document: PdfPreviewDocument | null, fallback = "") {
  return document?.displayFileName
    || document?.downloadFileName
    || document?.originalFileName
    || document?.originalFilename
    || document?.originalName
    || document?.fileName
    || fallback
    || "文件";
}

export function fileDownloadUrl(fileKind: string, fileId: string) {
  return `/api/files/${encodeURIComponent(fileKind)}/${encodeURIComponent(fileId)}/download`;
}

export function filePreviewUrl(fileKind: string, fileId: string) {
  return `/api/files/${encodeURIComponent(fileKind)}/${encodeURIComponent(fileId)}/preview`;
}

export function withCacheVersion(url: string, cacheKey?: string) {
  if (!url || !cacheKey) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(cacheKey)}`;
}
