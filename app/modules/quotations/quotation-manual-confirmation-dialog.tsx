"use client";

import { useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import styles from "./quotations.module.css";
import {
  quotationNumber,
  type QuotationDecisionChannel,
  type QuotationDetailResponse,
  type QuotationRow,
} from "./types";

const MANUAL_CHANNELS: Array<{ value: Exclude<QuotationDecisionChannel, "SYSTEM_EMAIL">; label: string }> = [
  { value: "EXTERNAL_EMAIL", label: "业务员邮箱／外部邮箱" },
  { value: "WECHAT", label: "微信" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "PHONE", label: "电话" },
  { value: "OTHER", label: "其他" },
];

type ManualChannel = (typeof MANUAL_CHANNELS)[number]["value"];

export function shanghaiDateInputValue(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function QuotationManualConfirmationDialog({
  quotation,
  expectedVersionNumber,
  onClose,
  onSaved,
}: {
  quotation: QuotationRow;
  expectedVersionNumber: number;
  onClose: () => void;
  onSaved: (quotation: QuotationRow, message: string) => void;
}) {
  const today = shanghaiDateInputValue();
  const [channel, setChannel] = useState<ManualChannel>("EXTERNAL_EMAIL");
  const [confirmationDate, setConfirmationDate] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const dirty = channel !== "EXTERNAL_EMAIL" || confirmationDate !== today || Boolean(note.trim());
  useWorkspaceTabBusy(saving);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    if (!confirmationDate) {
      setError("请填写客户确认日期");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await apiJson<QuotationDetailResponse>(
        `/api/quotations/${encodeURIComponent(quotation.id)}/manual-confirmation`,
        {
          method: "POST",
          body: JSON.stringify({ channel, confirmationDate, note: note.trim(), expectedVersionNumber }),
        },
      );
      const saved = result.quotation || result.data;
      if (!saved) throw new Error(result.message || "客户手动确认登记失败");
      onSaved(saved, result.message || "已手动登记客户接受报价");
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "客户手动确认登记失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <DismissibleLayer
      ariaLabel="手动确认客户接受报价"
      overlayClassName={shell.modalOverlay}
      surfaceClassName={shell.confirmDialog}
      onClose={onClose}
      dismissible={!saving}
      dismissConfirmMessage={dirty ? "手动确认信息尚未保存，确定关闭吗？" : ""}
    >
      {({ requestClose }) => <form className={styles.manualConfirmationForm} onSubmit={submit} inert={saving} aria-busy={saving}>
        <div className={shell.confirmDialogHeader}>
          <strong>手动确认客户接受</strong>
          <span>{quotationNumber(quotation) || "未编号"} · V{expectedVersionNumber}；仅在客户已通过系统外渠道确认时登记。</span>
        </div>
        {error ? <div className={shell.inlineError} role="alert" aria-live="assertive">{error}</div> : null}
        <label className={shell.confirmDialogInput}>确认渠道
          <select
            className={styles.manualConfirmationSelect}
            value={channel}
            required
            autoFocus
            onChange={(event) => setChannel(event.target.value as ManualChannel)}
          >
            {MANUAL_CHANNELS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={shell.confirmDialogInput}>客户确认日期
          <input type="date" value={confirmationDate} max={today} required onChange={(event) => setConfirmationDate(event.target.value)} />
        </label>
        <label className={shell.confirmDialogInput}>确认备注（可选）
          <textarea
            value={note}
            rows={3}
            maxLength={1000}
            aria-describedby="manual-confirmation-note-hint"
            placeholder="例如：邮件主题、客户联系人、确认内容或凭证位置"
            onChange={(event) => setNote(event.target.value)}
          />
          <small className={styles.manualConfirmationHint} id="manual-confirmation-note-hint">建议填写邮件主题、客户联系人等可追溯信息。</small>
        </label>
        <div className={shell.confirmDialogActions}>
          <button className={shell.secondaryButton} type="button" onClick={requestClose} disabled={saving}>取消</button>
          <button className={shell.primaryButtonCompact} type="submit" disabled={saving || !confirmationDate}>
            {saving ? "保存中..." : "确认客户已接受"}
          </button>
        </div>
      </form>}
    </DismissibleLayer>
  );
}
