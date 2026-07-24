import { useState } from "react";
import { apiJson } from "../../api";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import styles from "../../WorkspaceShell.module.css";
import { InvoiceGroupCard } from "./invoice-group-card";
import { logisticsApiErrorMessage, logisticsOcrResultMessage } from "./invoice-group-utils";
import type {
  LogisticsExpense,
  LogisticsExpenseMutationResult,
  LogisticsInvoiceGroupSummary,
} from "./model";
import { logisticsCurrencySummaryIsZero, logisticsExpenseBillAuditStatusFromRow } from "./shared";

type LogisticsInvoiceGroupsPanelProps = {
  expense: LogisticsExpense;
  items: LogisticsExpense[];
  groups: LogisticsInvoiceGroupSummary[];
  canUploadInvoice: boolean;
  canConfirmInvoice: boolean;
  canManageInvoiceRecognition: boolean;
  onUploaded: (result: LogisticsExpenseMutationResult) => void;
};

export function LogisticsInvoiceGroupsPanel({
  expense, items, groups, canUploadInvoice, canConfirmInvoice,
  canManageInvoiceRecognition, onUploaded,
}: LogisticsInvoiceGroupsPanelProps) {
  const [deletingGroupKey, setDeletingGroupKey] = useState("");
  const [confirmingValidationGroupKey, setConfirmingValidationGroupKey] = useState("");
  const [confirmingInvoiceGroupKey, setConfirmingInvoiceGroupKey] = useState("");
  const [recognizingGroupKey, setRecognizingGroupKey] = useState("");
  const [groupMessage, setGroupMessage] = useState<Record<string, string>>({});
  useWorkspaceTabBusy(Boolean(
    deletingGroupKey || confirmingValidationGroupKey || confirmingInvoiceGroupKey || recognizingGroupKey,
  ));
  const visibleGroups = groups.filter(
    (group) => (group.itemIds?.length || 0) > 0 || !logisticsCurrencySummaryIsZero(group.currencyTotals),
  );
  const workflowItems = items.filter(
    (item) => logisticsExpenseBillAuditStatusFromRow(item) === "审核通过",
  );
  if (!visibleGroups.length || !workflowItems.length) return null;

  function showMessage(groupKey: string, message: string) {
    setGroupMessage((current) => ({ ...current, [groupKey]: message }));
  }

  async function deleteInvoiceGroup(targetExpense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) {
    if (!group.invoiceDocumentId || !window.confirm("确定删除该发票文件？删除后需要重新上传。")) return;
    setDeletingGroupKey(group.key);
    showMessage(group.key, "");
    try {
      const response = await fetch(`/api/logistics-costs/${encodeURIComponent(targetExpense.id)}/invoice`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceGroup: group.key, documentId: group.invoiceDocumentId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) throw new Error(result.message || "删除发票失败");
      showMessage(group.key, "已删除发票");
      onUploaded(result);
    } catch (error) {
      showMessage(group.key, error instanceof Error ? error.message : "删除发票失败");
    } finally {
      setDeletingGroupKey("");
    }
  }

  async function manuallyConfirmValidation(targetExpense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) {
    const reason = window.prompt("请填写人工确认原因。");
    if (!reason?.trim()) return;
    setConfirmingValidationGroupKey(group.key);
    showMessage(group.key, "");
    try {
      const response = await fetch(`/api/logistics-costs/${encodeURIComponent(targetExpense.id)}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manualConfirmInvoiceValidation", invoiceGroup: group.key, reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) throw new Error(result.message || "人工确认失败");
      showMessage(group.key, "已人工确认通过");
      onUploaded(result);
    } catch (error) {
      showMessage(group.key, error instanceof Error ? error.message : "人工确认失败");
    } finally {
      setConfirmingValidationGroupKey("");
    }
  }

  async function confirmInvoiceGroup(targetExpense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) {
    if (!group.invoiceDocumentId || !window.confirm(`确认${group.label}已核对无误？确认后该分组将进入付款准备流程。`)) return;
    setConfirmingInvoiceGroupKey(group.key);
    showMessage(group.key, "");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/${encodeURIComponent(targetExpense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "confirmInvoice", invoiceGroup: group.key, documentId: group.invoiceDocumentId }),
      });
      if (result.success !== true) throw new Error(result.message || "确认发票失败");
      onUploaded(result);
      showMessage(group.key, "发票已确认");
    } catch (error) {
      showMessage(group.key, logisticsApiErrorMessage(error, "确认发票失败"));
    } finally {
      setConfirmingInvoiceGroupKey("");
    }
  }

  async function rerunInvoiceRecognition(targetExpense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) {
    setRecognizingGroupKey(group.key);
    showMessage(group.key, "正在识别，请勿关闭页面");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/${encodeURIComponent(targetExpense.id)}`, {
        method: "PATCH", timeoutMs: 65_000,
        body: JSON.stringify({ action: "rerunInvoiceRecognition", invoiceGroup: group.key, documentId: group.invoiceDocumentId || undefined }),
      });
      if (result.success !== true) throw new Error(result.message || "重新识别失败");
      onUploaded(result);
      showMessage(group.key, logisticsOcrResultMessage(result));
    } catch (error) {
      showMessage(group.key, logisticsApiErrorMessage(error, "重新识别失败"));
    } finally {
      setRecognizingGroupKey("");
    }
  }

  return (
    <div className={styles.logisticsInvoiceGroupsPanel}>
      <div className={styles.logisticsInvoiceGroupsHeader}>
        <div><strong>发票上传</strong><span>按费用类型分组上传，同一分组上传一次即可。</span></div>
      </div>
      <div className={styles.logisticsInvoiceGroupsGrid}>
        {visibleGroups.map((group) => (
          <InvoiceGroupCard
            key={group.key}
            expense={expense}
            items={items}
            group={group}
            canUploadInvoice={canUploadInvoice}
            canConfirmInvoice={canConfirmInvoice}
            canManageInvoiceRecognition={canManageInvoiceRecognition}
            deleting={deletingGroupKey === group.key}
            confirmingValidation={confirmingValidationGroupKey === group.key}
            confirmingInvoice={confirmingInvoiceGroupKey === group.key}
            recognizing={recognizingGroupKey === group.key}
            message={groupMessage[group.key] || ""}
            onDelete={deleteInvoiceGroup}
            onManualConfirm={manuallyConfirmValidation}
            onConfirm={confirmInvoiceGroup}
            onRecognize={rerunInvoiceRecognition}
            onUploaded={onUploaded}
          />
        ))}
      </div>
    </div>
  );
}
