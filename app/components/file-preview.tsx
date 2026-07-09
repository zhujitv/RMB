"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import styles from "../WorkspaceShell.module.css";
import { DismissibleLayer } from "./dismissible-layer";
import { mergeClassNames } from "./ui-primitives";

type PdfPreviewDocument = {
  id: string;
  fileName?: string;
  displayFileName?: string;
  downloadFileName?: string;
  originalFileName?: string;
  originalFilename?: string;
  originalName?: string;
};

type PdfPreviewMetadataResponse = {
  success?: boolean;
  document?: PdfPreviewDocument;
  file?: PdfPreviewDocument & { mimeType?: string; previewKind?: string };
  error?: string;
  message?: string;
};

type PdfPreviewState = "checking" | "ready" | "failed";
type PreviewContentKind = "pdf" | "image";
type FilePreviewMetaItem = {
  label: string;
  value: ReactNode;
};

function pdfPreviewStatusMessage(response: Response) {
  const code = response.headers.get("X-Preview-Error-Code") || "";
  if (response.status === 403) return "权限不足，无法预览该文件。";
  if (response.status === 404) return "文件不存在或已删除。";
  if (code === "R2_OBJECT_NOT_FOUND") return "文件地址失效，请重新上传或联系管理员。";
  if (code === "INVALID_FILE_TYPE") return "当前文件类型不支持在线预览。";
  if (code === "STORAGE_NETWORK_TIMEOUT") return "文件存储读取超时，请稍后重试。";
  return "文件暂时无法预览，请下载查看。";
}

function pdfPreviewFileName(document: PdfPreviewDocument | null, fallback = "") {
  return (
    document?.displayFileName
    || document?.downloadFileName
    || document?.originalFileName
    || document?.originalFilename
    || document?.originalName
    || document?.fileName
    || fallback
    || "文件"
  );
}

export function fileDownloadUrl(fileKind: string, fileId: string) {
  return `/api/files/${encodeURIComponent(fileKind)}/${encodeURIComponent(fileId)}/download`;
}

export function filePreviewUrl(fileKind: string, fileId: string) {
  return `/api/files/${encodeURIComponent(fileKind)}/${encodeURIComponent(fileId)}/preview`;
}

function withCacheVersion(url: string, cacheKey?: string) {
  if (!url || !cacheKey) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(cacheKey)}`;
}

export function FilePreviewModal({
  fileKind,
  fileId,
  title = "文件预览",
  initialFileName = "",
  metaItems = [],
  cacheKey = "",
  onClose,
  downloadLabel = "下载文件",
}: {
  fileKind: string;
  fileId: string;
  title?: string;
  initialFileName?: string;
  metaItems?: FilePreviewMetaItem[];
  cacheKey?: string;
  onClose: () => void;
  downloadLabel?: string;
}) {
  const [fileName, setFileName] = useState(initialFileName || "文件");
  const [error, setError] = useState("");
  const [previewState, setPreviewState] = useState<PdfPreviewState>("checking");
  const [previewError, setPreviewError] = useState("");
  const [previewKind, setPreviewKind] = useState<PreviewContentKind>("pdf");
  const [zoom, setZoom] = useState(100);
  const encodedKind = encodeURIComponent(fileKind);
  const encodedId = encodeURIComponent(fileId);
  const cacheVersion = String(cacheKey || "");
  const metadataUrl = withCacheVersion(`/api/files/${encodedKind}/${encodedId}`, cacheVersion);
  const previewUrl = withCacheVersion(filePreviewUrl(fileKind, fileId), cacheVersion);
  const downloadUrl = withCacheVersion(fileDownloadUrl(fileKind, fileId), cacheVersion);
  const previewSource = previewKind === "pdf" ? `${previewUrl}#zoom=${zoom}` : previewUrl;

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      try {
        const response = await fetch(metadataUrl, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const result = await response.json().catch(() => ({} as PdfPreviewMetadataResponse));
        if (!response.ok) throw new Error(result.error || result.message || "读取文件信息失败");
        if (cancelled) return;
        setFileName(pdfPreviewFileName(result.file || result.document || null, initialFileName));
        setError("");
      } catch (metadataError) {
        if (cancelled) return;
        setFileName(initialFileName || "文件");
        setError(metadataError instanceof Error ? metadataError.message : "读取文件信息失败");
      }
    }

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [metadataUrl, initialFileName]);

  useEffect(() => {
    let cancelled = false;

    async function verifyPreviewStream() {
      setPreviewState("checking");
      setPreviewError("");
      try {
        const response = await fetch(previewUrl, {
          method: "HEAD",
          cache: "no-store",
          credentials: "same-origin",
        });
        const contentType = response.headers.get("Content-Type") || "";
        if (!response.ok) throw new Error(pdfPreviewStatusMessage(response));
        const normalizedContentType = contentType.toLowerCase();
        if (normalizedContentType.includes("application/pdf")) {
          if (!cancelled) setPreviewKind("pdf");
        } else if (normalizedContentType.includes("image/jpeg") || normalizedContentType.includes("image/png") || normalizedContentType.includes("image/webp")) {
          if (!cancelled) setPreviewKind("image");
        } else {
          throw new Error("文件暂时无法预览，请下载查看。");
        }
        if (!cancelled) setPreviewState("ready");
      } catch (previewLoadError) {
        if (cancelled) return;
        setPreviewState("failed");
        setPreviewError(previewLoadError instanceof Error ? previewLoadError.message : "文件暂时无法预览，请下载查看。");
      }
    }

    void verifyPreviewStream();
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  return (
    <DismissibleLayer
      ariaLabel={`${title}：${fileName}`}
      overlayClassName={styles.modalOverlay}
      surfaceClassName={styles.paymentVoucherModal}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
          <header className={styles.modalHeader}>
            <div>
              <strong>{title}</strong>
              <span>{fileName}</span>
              {error ? <span>{error}</span> : null}
            </div>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </header>
          {metaItems.length ? (
            <div className={styles.paymentVoucherMeta}>
              {metaItems.map((item) => (
                <span key={item.label}>
                  <strong>{item.label}</strong>
                  {item.value || "-"}
                </span>
              ))}
            </div>
          ) : null}
          <div className={styles.paymentVoucherPreviewBody}>
            {previewState === "checking" ? (
              <div className={styles.paymentVoucherFallback}>正在加载文件预览...</div>
            ) : null}
            {previewState === "ready" ? (
              previewKind === "image" ? (
                <div className={styles.paymentVoucherImageFrame}>
                  <img
                    src={previewUrl}
                    alt={fileName}
                    style={{ width: `${zoom}%`, maxWidth: zoom > 100 ? "none" : "100%" }}
                    onError={() => {
                      setPreviewState("failed");
                      setPreviewError("文件暂时无法预览，请下载查看。");
                    }}
                  />
                </div>
              ) : (
                <iframe
                  src={previewSource}
                  title={fileName}
                  className={styles.paymentVoucherFrame}
                  onError={() => {
                    setPreviewState("failed");
                    setPreviewError("文件暂时无法预览，请下载查看。");
                  }}
                />
              )
            ) : null}
            {previewState === "failed" ? (
              <div className={styles.paymentVoucherFallback}>
                <span>{previewError || "文件暂时无法预览，请下载查看。"}</span>
              </div>
            ) : null}
          </div>
          <footer className={styles.modalFooter}>
            <button
              className={styles.ghostButton}
              type="button"
              onClick={() => setZoom((current) => Math.max(75, current - 25))}
              disabled={zoom <= 75}
            >
              缩小
            </button>
            <span>{zoom}%</span>
            <button
              className={styles.ghostButton}
              type="button"
              onClick={() => setZoom((current) => Math.min(200, current + 25))}
              disabled={zoom >= 200}
            >
              放大
            </button>
            <a className={styles.primaryButtonCompact} href={downloadUrl}>{downloadLabel}</a>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </footer>
        </>
      )}
    </DismissibleLayer>
  );
}

export function PdfPreviewButton({
  documentId,
  fileName = "",
  className,
  children = "预览",
}: {
  documentId: string;
  fileName?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={mergeClassNames(styles.fileActionButton, className)} type="button" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open ? (
        <PdfPreviewDrawer
          documentId={documentId}
          initialFileName={fileName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function PdfPreviewDrawer({
  documentId,
  initialFileName = "",
  onClose,
}: {
  documentId: string;
  initialFileName?: string;
  onClose: () => void;
}) {
  return (
    <FilePreviewModal
      fileKind="order-document"
      fileId={documentId}
      title="文件预览"
      initialFileName={initialFileName}
      onClose={onClose}
    />
  );
}
