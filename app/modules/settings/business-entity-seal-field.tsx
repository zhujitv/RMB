import { useRef, useState } from "react";
import { apiJson } from "../../api";
import styles from "../../WorkspaceShell.module.css";
import {
  ELECTRONIC_SEAL_UPLOAD_ACCEPT,
  uploadFormDataWithProgress,
  validateElectronicSealUploadFile,
} from "../../utils";
import type { BusinessEntityRow } from "./types";

export function BusinessEntitySealField({
  entityId,
  entity,
  onSealSaved,
}: {
  entityId: string;
  entity: BusinessEntityRow | null;
  onSealSaved: (entity: BusinessEntityRow) => void | Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function uploadSeal(file: File | null | undefined) {
    if (!entityId) {
      setMessage("请先保存业务主体，再上传电子章。");
      return;
    }
    const validationError = validateElectronicSealUploadFile(file || null);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setUploading(true);
    setProgress(1);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file as File);
      const result = await uploadFormDataWithProgress<{ entity?: BusinessEntityRow; message?: string }>(
        `/api/settings/business-entities/${encodeURIComponent(entityId)}/seal`,
        formData,
        setProgress,
      );
      if (result.entity) await onSealSaved(result.entity);
      setMessage(result.message || "业务主体电子章已上传");
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传电子章失败");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function deleteSeal() {
    if (!entityId || !entity?.hasElectronicSeal) return;
    if (!window.confirm("确认删除该业务主体电子章？删除后新上传的供应商合同不会自动盖章。")) return;
    setUploading(true);
    setMessage("");
    try {
      const result = await apiJson<{ entity?: BusinessEntityRow; message?: string }>(
        `/api/settings/business-entities/${encodeURIComponent(entityId)}/seal`,
        { method: "DELETE" },
      );
      if (result.entity) await onSealSaved(result.entity);
      setMessage(result.message || "业务主体电子章已删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除电子章失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.documentGroupCard}>
      <strong>需方电子章</strong>
      <div className={styles.emptyState}>上传透明背景 PNG。供应商回传工厂采购合同时，系统会识别每份合同中的“需方（盖章）”位置后自动盖章；无法可靠识别时会停止上传，避免盖错。</div>
      {entity?.hasElectronicSeal ? (
        <div className={styles.fileUploadFile}>
          <img
            src={`/api/settings/business-entities/${encodeURIComponent(entityId)}/seal?${encodeURIComponent(String(entity.electronicSeal?.uploadedAt || ""))}`}
            alt="当前电子章"
            style={{ maxWidth: 120, maxHeight: 120, objectFit: "contain" }}
          />
          <span className={styles.fileUploadFileName}>{entity.electronicSeal?.fileName || "电子章.png"}</span>
        </div>
      ) : (
        <div className={styles.emptyState}>尚未上传电子章；未上传时供应商合同按原样保存。</div>
      )}
      <div className={styles.detailActions}>
        <label className={styles.secondaryButton}>
          {uploading ? `上传中 ${progress || 1}%` : entity?.hasElectronicSeal ? "替换电子章" : "上传电子章"}
          <input
            ref={inputRef}
            type="file"
            accept={ELECTRONIC_SEAL_UPLOAD_ACCEPT}
            disabled={uploading || !entityId}
            style={{ display: "none" }}
            onChange={(event) => void uploadSeal(event.target.files?.[0] || null)}
          />
        </label>
        {entity?.hasElectronicSeal ? (
          <button className={styles.secondaryButton} type="button" disabled={uploading} onClick={deleteSeal}>删除电子章</button>
        ) : null}
      </div>
      {message ? (
        <div className={message.includes("失败") || message.includes("错误") || message.includes("仅支持") ? styles.inlineError : styles.emptyState}>{message}</div>
      ) : null}
    </div>
  );
}
