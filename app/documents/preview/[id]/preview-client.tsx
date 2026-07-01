"use client";

import { useEffect, useMemo, useState } from "react";

type DocumentMetadata = {
  displayFileName?: string;
  downloadFileName?: string;
  originalFileName?: string;
  originalFilename?: string;
  originalName?: string;
  fileName?: string;
  documentTypeLabel?: string;
};

type MetadataResponse = {
  success?: boolean;
  document?: DocumentMetadata;
  file?: DocumentMetadata;
  error?: string;
};

type PreviewState = "checking" | "ready" | "failed";

function displayNameFromMetadata(document: DocumentMetadata | null) {
  return (
    document?.displayFileName
    || document?.downloadFileName
    || document?.originalFileName
    || document?.originalFilename
    || document?.originalName
    || document?.fileName
    || ""
  );
}

function previewStatusMessage(response: Response) {
  if (response.status === 403) return "权限不足，无法预览该文件。";
  if (response.status === 404) return "文件不存在或已删除。";
  return "文件暂时无法预览，请下载查看。";
}

export function DocumentPreviewClient({ documentId, initialFileName = "" }: { documentId: string; initialFileName?: string }) {
  const [fileName, setFileName] = useState(initialFileName);
  const [error, setError] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState>("checking");
  const [previewError, setPreviewError] = useState("");

  const encodedId = useMemo(() => encodeURIComponent(documentId), [documentId]);
  const previewUrl = `/api/files/order-document/${encodedId}/preview`;
  const downloadUrl = `/api/files/order-document/${encodedId}/download`;

  useEffect(() => {
    let cancelled = false;
    if (initialFileName) document.title = initialFileName;

    async function loadMetadata() {
      try {
        const response = await fetch(`/api/files/order-document/${encodedId}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const result = await response.json().catch(() => ({} as MetadataResponse));
        if (!response.ok) throw new Error(result?.error || "读取文件信息失败");
        const nextFileName = displayNameFromMetadata(result.file || result.document || null);
        if (cancelled) return;
        if (nextFileName) {
          setFileName(nextFileName);
          document.title = nextFileName;
        }
      } catch (metadataError) {
        if (cancelled) return;
        const message = metadataError instanceof Error ? metadataError.message : "读取文件信息失败";
        setError(message);
        document.title = "无法打开文件";
      }
    }

    void loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [encodedId, initialFileName]);

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
        if (!response.ok) throw new Error(previewStatusMessage(response));
        if (!contentType.toLowerCase().includes("application/pdf")) {
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
    <main style={{
      display: "flex",
      minHeight: "100vh",
      flexDirection: "column",
      background: "#0f172a",
    }}>
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
        background: "rgba(15, 23, 42, 0.94)",
        color: "#f8fafc",
        padding: "10px 16px",
      }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 14,
            lineHeight: "20px",
          }}>
            {fileName || "正在打开文件..."}
          </strong>
          {error ? (
            <span style={{ color: "#fecaca", fontSize: 12 }}>{error}</span>
          ) : null}
        </div>
        <a
          href={downloadUrl}
          style={{
            flex: "0 0 auto",
            border: "1px solid rgba(191, 219, 254, 0.72)",
            borderRadius: 8,
            color: "#ffffff",
            fontSize: 13,
            lineHeight: "18px",
            padding: "7px 12px",
            textDecoration: "none",
          }}
        >
          下载
        </a>
      </header>
      <section
        style={{
          flex: "1 1 auto",
          width: "100%",
          minHeight: "calc(100vh - 80px)",
          background: "#111827",
        }}
      >
        {previewState === "checking" ? (
          <div style={{
            display: "grid",
            minHeight: "calc(100vh - 80px)",
            placeItems: "center",
            color: "#f8fafc",
            padding: 24,
            textAlign: "center",
          }}>
            <p style={{ margin: 0 }}>正在加载 PDF 预览...</p>
          </div>
        ) : null}
        {previewState === "ready" ? (
          <iframe
            src={previewUrl}
            title={fileName || "PDF 文件预览"}
            style={{
              display: "block",
              width: "100%",
              minHeight: "calc(100vh - 80px)",
              border: 0,
              background: "#111827",
            }}
            onError={() => {
              setPreviewState("failed");
              setPreviewError("在线预览失败，请下载文件查看。");
            }}
          />
        ) : null}
        {previewState === "failed" ? (
          <div style={{
            display: "grid",
            minHeight: "calc(100vh - 80px)",
            placeItems: "center",
            color: "#f8fafc",
            padding: 24,
            textAlign: "center",
          }}>
            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0, fontWeight: 700 }}>在线预览失败</p>
              <span style={{ color: "#cbd5e1", fontSize: 13 }}>{previewError || "请下载文件查看。"}</span>
              <a href={downloadUrl} style={{ color: "#bfdbfe" }}>下载文件</a>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
