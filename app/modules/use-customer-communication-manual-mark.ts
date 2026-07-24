import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { apiJson } from "../api";
import type { CommunicationDetail, CommunicationRow, MailForm } from "./customer-communication-types";
import {
  currentDateTimeLocalValue,
  formFromDraft,
  type ManualMarkDialogState,
} from "./customer-communication-utils";

type ManualMarkContext = {
  detailOrderId: string;
  setRows: Dispatch<SetStateAction<CommunicationRow[]>>;
  setDetail: Dispatch<SetStateAction<CommunicationDetail | null>>;
  setMailForm: Dispatch<SetStateAction<MailForm | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useCustomerCommunicationManualMark(context: ManualMarkContext) {
  const { detailOrderId, setRows, setDetail, setMailForm, setError, setNotice } = context;
  const [manualMarkDialog, setManualMarkDialog] = useState<ManualMarkDialogState | null>(null);
  const [manualMarkBusyId, setManualMarkBusyId] = useState("");
  const [manualMarkError, setManualMarkError] = useState("");

  function updateRowFromDetail(nextDetail: CommunicationDetail) {
    if (!nextDetail.order?.id) return;
    setRows((current) => current.map((row) => (
      row.id === nextDetail.order.id ? { ...row, ...nextDetail.order } : row
    )));
    if (detailOrderId === nextDetail.order.id) {
      setDetail(nextDetail);
      setMailForm(formFromDraft(nextDetail.draft || null));
    }
  }

  function openManualMarkDialog(row: CommunicationRow) {
    setManualMarkError("");
    setManualMarkDialog({
      row,
      deliveryMethod: "手动邮件",
      sentAt: currentDateTimeLocalValue(),
      remark: "",
    });
  }

  async function submitManualMark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualMarkDialog) return;
    const row = manualMarkDialog.row;
    setManualMarkBusyId(row.id);
    setManualMarkError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; detail?: CommunicationDetail }>(
        `/api/customer-communications/${encodeURIComponent(row.id)}/mark-sent`,
        {
          method: "POST",
          body: JSON.stringify({
            deliveryMethod: manualMarkDialog.deliveryMethod,
            sentAt: manualMarkDialog.sentAt,
            remark: manualMarkDialog.remark,
          }),
        },
      );
      if (result.success !== true || !result.detail) throw new Error(result.message || "手动标记已发送失败");
      updateRowFromDetail(result.detail);
      setManualMarkDialog(null);
      setNotice(result.message || "已手动标记为已发送。");
    } catch (markError) {
      setManualMarkError(markError instanceof Error ? markError.message : "手动标记已发送失败");
    } finally {
      setManualMarkBusyId("");
    }
  }

  async function unmarkManualSent(row: CommunicationRow) {
    if (!window.confirm(`确认取消订单 ${row.orderNo || "-"} 的手动已发送标记？`)) return;
    setManualMarkBusyId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; detail?: CommunicationDetail }>(
        `/api/customer-communications/${encodeURIComponent(row.id)}/unmark-sent`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (result.success !== true || !result.detail) throw new Error(result.message || "取消手动发送标记失败");
      updateRowFromDetail(result.detail);
      setNotice(result.message || "已取消手动发送标记。");
    } catch (unmarkError) {
      setError(unmarkError instanceof Error ? unmarkError.message : "取消手动发送标记失败");
    } finally {
      setManualMarkBusyId("");
    }
  }

  return {
    manualMarkDialog,
    setManualMarkDialog,
    manualMarkBusyId,
    manualMarkError,
    openManualMarkDialog,
    submitManualMark,
    unmarkManualSent,
  };
}
