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
  error?: string;
};

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

export function DocumentPreviewClient({ documentId }: { documentId: string }) {
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");

  const encodedId = useMemo(() => encodeURIComponent(documentId), [documentId]);
  const previewUrl = `/api/order-documents/${encodedId}/preview`;
  const downloadUrl = `/api/order-documents/${encodedId}/download`;

  useEffect(() => {
    let cancelled = false;

    async function loadMetadata() {
      try {
        const response = await fetch(`/api/order-documents/${encodedId}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const result = await response.json().catch(() => ({} as MetadataResponse));
        if (!response.ok) throw new Error(result?.error || "读取文件信息失败");
        const nextFileName = displayNameFromMetadata(result.document || null);
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
  }, [encodedId]);

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
      <iframe
        src={previewUrl}
        title={fileName || "文件"}
        style={{
          flex: "1 1 auto",
          width: "100%",
          border: 0,
          background: "#111827",
        }}
      />
    </main>
  );
}
