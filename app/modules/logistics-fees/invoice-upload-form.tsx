import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { preventEnterFormSubmit } from "../../formGuards";
import {
  PDF_UPLOAD_ACCEPT,
  PDF_UPLOAD_MAX_SIZE_LABEL,
  uploadFormDataWithProgress,
  validatePdfUploadFile,
} from "../../utils";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import styles from "../../WorkspaceShell.module.css";
import { logisticsApiErrorMessage } from "./invoice-group-utils";
import type {
  LogisticsExpense,
  LogisticsExpenseMutationResult,
  LogisticsInvoiceGroupSummary,
} from "./model";

export function InvoiceUploadForm({
  expense,
  group,
  onUploaded,
}: {
  expense: LogisticsExpense;
  group: LogisticsInvoiceGroupSummary;
  onUploaded: (result: LogisticsExpenseMutationResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "failed">("idle");
  useWorkspaceTabBusy(uploading);

  async function uploadInvoice(file: File) {
    const validationError = validatePdfUploadFile(file);
    if (validationError) {
      setStatus("failed");
      setProgress(0);
      setMessage(validationError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setUploading(true);
    setProgress(0);
    setStatus("uploading");
    setMessage("上传中 0%");
    const body = new FormData();
    body.set("invoiceGroup", group.key);
    body.set("file", file);
    try {
      const result = await uploadFormDataWithProgress<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}/invoice`,
        body,
        (nextProgress) => {
          setProgress(nextProgress);
          setMessage(`上传中 ${nextProgress}%`);
        },
      );
      setProgress(100);
      setStatus("success");
      setMessage("上传成功，系统正在识别");
      onUploaded(result);
    } catch (uploadError) {
      setStatus("failed");
      setMessage(logisticsApiErrorMessage(uploadError, "上传失败，请重试"));
      setProgress(0);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile || uploading) return;
    void uploadInvoice(selectedFile);
  }

  return (
    <form className={styles.inlineInvoiceForm} onKeyDown={preventEnterFormSubmit} onSubmit={(event) => event.preventDefault()}>
      <input
        ref={inputRef}
        type="file"
        accept={PDF_UPLOAD_ACCEPT}
        aria-label={`${group.label}选择发票文件`}
        onChange={handleFileChange}
        disabled={uploading}
      />
      <span className={styles.invoiceUploadHelp}>仅支持 PDF，最大 {PDF_UPLOAD_MAX_SIZE_LABEL}。选择文件后自动上传。</span>
      {status !== "idle" ? (
        <span className={styles.invoiceUploadStatus} data-status={status}>
          <span className={styles.invoiceUploadProgressBar}>
            <span style={{ width: `${status === "success" ? 100 : progress}%` }} />
          </span>
          <span>{message || (status === "uploading" ? `上传中 ${progress}%` : status === "success" ? "上传成功" : "上传失败，请重试")}</span>
        </span>
      ) : null}
    </form>
  );
}
