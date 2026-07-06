import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { PdfPreviewButton } from "../../components";
import { formatDateTime } from "../../formatters";
import { preventEnterFormSubmit } from "../../formGuards";
import {
  PDF_UPLOAD_ACCEPT,
  PDF_UPLOAD_MAX_SIZE_LABEL,
  uploadFormDataWithProgress,
  validatePdfUploadFile,
} from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { logisticsInvoiceGroupForExpense } from "../../../lib/platform/logistics-invoice-groups";
import type {
  LogisticsExpense,
  LogisticsExpenseMutationResult,
  LogisticsInvoiceGroupSummary,
} from "./model";
import {
  currencySummaryFromSingleExpense,
  logisticsCurrencySummaryIsZero,
  LogisticsCurrencyAmountList,
  logisticsExpenseBillAuditStatusFromRow,
  StatusPill,
} from "./shared";

export function LogisticsInvoiceGroupsPanel({
  expense,
  items,
  groups,
  canUploadInvoice,
  onUploaded,
}: {
  expense: LogisticsExpense;
  items: LogisticsExpense[];
  groups: LogisticsInvoiceGroupSummary[];
  canUploadInvoice: boolean;
  onUploaded: (result: LogisticsExpenseMutationResult) => void;
}) {
  const [deletingGroupKey, setDeletingGroupKey] = useState("");
  const [confirmingGroupKey, setConfirmingGroupKey] = useState("");
  const [groupMessage, setGroupMessage] = useState<Record<string, string>>({});
  const visibleGroups = groups.filter(
    (group) =>
      (group.itemIds?.length || 0) > 0 ||
      !logisticsCurrencySummaryIsZero(group.currencyTotals),
  );
	const uploadableItems = items.filter(
		(item) => ["待审核", "审核通过"].includes(logisticsExpenseBillAuditStatusFromRow(item)),
	);
	if (!visibleGroups.length || !uploadableItems.length) return null;

  async function deleteInvoiceGroup(
    targetExpense: LogisticsExpense,
    group: LogisticsInvoiceGroupSummary,
  ) {
    if (!group.invoiceDocumentId) return;
    if (!window.confirm("确定删除该发票文件？删除后需要重新上传。")) return;
    setDeletingGroupKey(group.key);
    setGroupMessage((current) => ({ ...current, [group.key]: "" }));
    try {
      const response = await fetch(
        `/api/logistics-costs/${encodeURIComponent(targetExpense.id)}/invoice`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoiceGroup: group.key,
            documentId: group.invoiceDocumentId,
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true)
        throw new Error(result.message || "删除发票失败");
      setGroupMessage((current) => ({ ...current, [group.key]: "已删除发票" }));
      onUploaded(result);
    } catch (error) {
      setGroupMessage((current) => ({
        ...current,
        [group.key]: error instanceof Error ? error.message : "删除发票失败",
      }));
    } finally {
      setDeletingGroupKey("");
    }
  }

  async function manuallyConfirmValidation(
    targetExpense: LogisticsExpense,
    group: LogisticsInvoiceGroupSummary,
  ) {
    const reason = window.prompt("请填写人工确认原因。");
    if (!reason?.trim()) return;
    setConfirmingGroupKey(group.key);
    setGroupMessage((current) => ({ ...current, [group.key]: "" }));
    try {
      const response = await fetch(`/api/logistics-costs/${encodeURIComponent(targetExpense.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manualConfirmInvoiceValidation",
          invoiceGroup: group.key,
          reason,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true)
        throw new Error(result.message || "人工确认失败");
      setGroupMessage((current) => ({ ...current, [group.key]: "已人工确认通过" }));
      onUploaded(result);
    } catch (error) {
      setGroupMessage((current) => ({
        ...current,
        [group.key]: error instanceof Error ? error.message : "人工确认失败",
      }));
    } finally {
      setConfirmingGroupKey("");
    }
  }

  return (
    <div className={styles.logisticsInvoiceGroupsPanel}>
      <div className={styles.logisticsInvoiceGroupsHeader}>
        <div>
          <strong>发票上传</strong>
          <span>按费用类型分组上传，同一分组上传一次即可。</span>
        </div>
      </div>
      <div className={styles.logisticsInvoiceGroupsGrid}>
        {visibleGroups.map((group) => {
          const groupItems = items.filter(
            (item) => logisticsInvoiceGroupForExpense(item)?.key === group.key,
          );
          const groupCostTypes = [
            ...new Set(groupItems.map((item) => item.costType).filter(Boolean)),
          ];
          const targetExpense = groupItems[0] || expense;
          const uploaded = Boolean(
            group.uploaded ||
            group.status === "已上传" ||
            group.status === "已确认",
          );
          const confirmed = Boolean(
            group.confirmed || group.status === "已确认",
          );
          const validationStatus = group.validationStatus || (uploaded ? "已上传待识别" : "未上传");
          const validationPassed = ["校验通过", "人工确认通过"].includes(validationStatus);
          const validationProblem = uploaded && !validationPassed && validationStatus !== "识别中" && validationStatus !== "已上传待识别";
          const recognizedAmount = Number(group.recognizedAmount || 0);
	          const recognizedName = group.recognizedName || "-";
	          const recognizedSeller = group.recognizedSeller || "-";
	          const recognizedBuyer = group.recognizedBuyer || "-";
          const invoiceDocument =
            groupItems
              .map((item) => item.invoiceDocument)
              .find((document) => document?.id) || null;
          const uploadedByName =
            invoiceDocument?.uploadedBy?.name ||
            groupItems
              .map((item) => item.invoiceUploadedBy?.name || "")
              .find(Boolean) ||
            "-";
          const uploadedAt =
            invoiceDocument?.uploadedAt ||
            groupItems
              .map((item) => item.invoiceUploadedAt || "")
              .find(Boolean) ||
            "";
          const canUploadGroup =
            canUploadInvoice &&
            groupItems.length > 0 &&
	            groupItems.every((item) =>
	              ["待审核", "审核通过"].includes(logisticsExpenseBillAuditStatusFromRow(item)),
	            ) &&
            !uploaded &&
            !confirmed;
          const canDeleteGroup =
            canUploadInvoice &&
            uploaded &&
            !confirmed &&
            Boolean(group.invoiceDocumentId);
          return (
            <div className={styles.logisticsInvoiceGroupCard} key={group.key}>
              <div className={styles.logisticsInvoiceGroupTitle}>
                <strong>{group.label}</strong>
                <StatusPill value={group.status || "待开票"} />
              </div>
              <div className={styles.logisticsInvoiceGroupMeta}>
                <span>
                  包含费用：
                  {(groupCostTypes.length
                    ? groupCostTypes
                    : group.costTypes || []
                  )
                    .map((type) => logisticsCostTypeLabel(type))
                    .join(" / ") || "-"}
                </span>
                <span>
                  分组合计：
                  <LogisticsCurrencyAmountList
                    summary={
                      group.currencyTotals ||
                      currencySummaryFromSingleExpense(targetExpense)
                    }
                    compact
                  />
                </span>
                {group.invoiceNotificationError ? (
                  <span className={styles.logisticsInvoiceGroupError}>
                    {group.invoiceNotificationError}
                  </span>
                ) : null}
              </div>
              {uploaded ? (
                <div className={styles.logisticsInvoiceFileList}>
                  <strong>已上传文件列表</strong>
                  <div className={styles.logisticsInvoiceFileRow}>
                    <span
                      className={styles.logisticsInvoiceFileName}
                      title={
                        invoiceDocument?.fileName ||
                        invoiceDocument?.originalFilename ||
                        "物流发票.pdf"
                      }
                    >
                      {invoiceDocument?.fileName ||
                        invoiceDocument?.originalFilename ||
                        "物流发票.pdf"}
                    </span>
                    <span>上传人：{uploadedByName}</span>
                    <span>
                      上传时间：{uploadedAt ? formatDateTime(uploadedAt) : "-"}
                    </span>
                    {group.invoiceDocumentId ? (
                      <PdfPreviewButton
                        documentId={group.invoiceDocumentId}
                        fileName={
                          invoiceDocument?.fileName ||
                          invoiceDocument?.originalFilename ||
                          "物流发票.pdf"
                        }
                      />
                    ) : null}
                    {canDeleteGroup ? (
                      <button
                        className={styles.fileDangerButton}
                        type="button"
                        disabled={deletingGroupKey === group.key}
                        onClick={() => deleteInvoiceGroup(targetExpense, group)}
                      >
                        {deletingGroupKey === group.key ? "删除中..." : "删除"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {uploaded ? (
                <div className={styles.logisticsInvoiceValidationBox}>
                  <div className={styles.logisticsInvoiceValidationHead}>
                    <span>发票校验</span>
                    <StatusPill value={validationStatus} />
                  </div>
                  <div className={styles.logisticsInvoiceValidationGrid}>
                    <div className={styles.logisticsInvoiceValidationItem}>
                      <span>系统分组合计</span>
                      <strong title={logisticsCurrencySummaryText(group)}>
                        {logisticsCurrencySummaryText(group)}
                      </strong>
                    </div>
                    <div className={styles.logisticsInvoiceValidationItem}>
                      <span>识别发票金额</span>
                      <strong title={recognizedAmount ? `${recognizedAmount.toFixed(2)}` : "-"}>
                        {recognizedAmount ? recognizedAmount.toFixed(2) : "-"}
                      </strong>
                    </div>
                    <div className={styles.logisticsInvoiceValidationItem}>
                      <span>系统费用分组</span>
                      <strong title={group.label}>{group.label}</strong>
                    </div>
	                    <div className={styles.logisticsInvoiceValidationItem}>
	                      <span>识别品名</span>
	                      <strong title={recognizedName}>{recognizedName}</strong>
	                    </div>
	                    <div className={styles.logisticsInvoiceValidationItem}>
	                      <span>识别销售方</span>
	                      <strong title={recognizedSeller}>{recognizedSeller}</strong>
	                    </div>
	                    <div className={styles.logisticsInvoiceValidationItem}>
	                      <span>识别购买方</span>
	                      <strong title={recognizedBuyer}>{recognizedBuyer}</strong>
	                    </div>
                    <div className={styles.logisticsInvoiceValidationItem}>
                      <span>发票号码</span>
                      <strong title={group.recognizedInvoiceNo || "-"}>{group.recognizedInvoiceNo || "-"}</strong>
                    </div>
                    <div className={styles.logisticsInvoiceValidationItem}>
                      <span>开票日期</span>
                      <strong title={group.recognizedInvoiceDate || "-"}>{group.recognizedInvoiceDate || "-"}</strong>
                    </div>
                  </div>
                  {group.validationMessage ? (
                    <div className={styles.logisticsInvoiceValidationError}>
                      {group.validationMessage}
                    </div>
                  ) : null}
                  {validationProblem && canUploadInvoice ? (
                    <div className={styles.logisticsInvoiceValidationActions}>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        disabled={confirmingGroupKey === group.key}
                        onClick={() => manuallyConfirmValidation(targetExpense, group)}
                      >
                        {confirmingGroupKey === group.key ? "确认中..." : "人工确认通过"}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canUploadGroup ? (
                <InvoiceUploadForm
                  expense={targetExpense}
                  group={group}
                  onUploaded={onUploaded}
                />
              ) : null}
              {groupMessage[group.key] ? (
                <span className={styles.inlineFormMessage}>
                  {groupMessage[group.key]}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function logisticsCurrencySummaryText(group: LogisticsInvoiceGroupSummary) {
  const summary = group.currencyTotals;
  if (!summary) return "-";
  const values = [
    summary.cnyActual ? `CNY ${Number(summary.cnyActual).toFixed(2)}` : "",
    ...(summary.foreignTotals || []).map((item) => `${item.currency} ${Number(item.amount || 0).toFixed(2)}`),
  ].filter(Boolean);
  return values.length ? values.join(" / ") : "-";
}

function InvoiceUploadForm({
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
  const [status, setStatus] = useState<
    "idle" | "uploading" | "success" | "failed"
  >("idle");

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
      const result =
        await uploadFormDataWithProgress<LogisticsExpenseMutationResult>(
          `/api/logistics-costs/${encodeURIComponent(expense.id)}/invoice`,
          body,
          (nextProgress) => {
            setProgress(nextProgress);
            setMessage(`上传中 ${nextProgress}%`);
          },
        );
      setProgress(100);
      setStatus("success");
      setMessage("上传成功");
      onUploaded(result);
    } catch (uploadError) {
      setStatus("failed");
      setMessage(
        uploadError instanceof Error ? uploadError.message : "上传失败，请重试",
      );
      setProgress(0);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile || uploading) return;
    uploadInvoice(selectedFile);
  }

  return (
    <form
      className={styles.inlineInvoiceForm}
      onKeyDown={preventEnterFormSubmit}
      onSubmit={(event) => event.preventDefault()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={PDF_UPLOAD_ACCEPT}
        aria-label={`${group.label}选择发票文件`}
        onChange={handleFileChange}
        disabled={uploading}
      />
      <span className={styles.invoiceUploadHelp}>
        仅支持 PDF，最大 {PDF_UPLOAD_MAX_SIZE_LABEL}。选择文件后自动上传。
      </span>
      {status !== "idle" ? (
        <span className={styles.invoiceUploadStatus} data-status={status}>
          <span className={styles.invoiceUploadProgressBar}>
            <span
              style={{ width: `${status === "success" ? 100 : progress}%` }}
            />
          </span>
          <span>
            {message ||
              (status === "uploading"
                ? `上传中 ${progress}%`
                : status === "success"
                  ? "上传成功"
                  : "上传失败，请重试")}
          </span>
        </span>
      ) : null}
    </form>
  );
}
