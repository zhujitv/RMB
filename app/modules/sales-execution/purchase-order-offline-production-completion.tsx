"use client";

import { useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import styles from "./offline-confirmation.module.css";
import actionStyles from "./purchase-order-actions.module.css";
import {
  CONFIRMATION_EVIDENCE_ACCEPT,
  uploadConfirmationEvidence,
  validateConfirmationEvidenceFile,
} from "./confirmation-evidence-upload";
import {
  OFFLINE_FACTORY_CHANNELS,
  shanghaiDateTimeInputValue,
  shanghaiDateTimeIso,
  type OfflineFactoryConfirmationChannel,
} from "./offline-confirmation-values";
import type { FactoryPurchaseOrder } from "./types";

type SavedCompletionData = { purchaseOrderId?: string; confirmationEventKey?: string };
type SavedCompletion = {
  success?: boolean;
  message?: string;
  data?: SavedCompletionData;
  result?: SavedCompletionData;
};

export function PurchaseOrderOfflineProductionCompletion({
  executionId,
  order,
  canManage,
  onChanged,
  onSaved,
}: {
  executionId: string;
  order: FactoryPurchaseOrder;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
  onSaved: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const canRecord = canManage
    && order.status === "ACCEPTED"
    && order.productionStatus === "IN_PRODUCTION"
    && Boolean(order.productionProgress?.allCompleted)
    && !order.productionCompletedAt
    && !order.actualDeliveryDate;
  if (!canRecord) return null;
  const quantityVariancePending = order.deliveryQuantityVariances?.some((entry) => entry.status === "PENDING") === true;
  return (
    <>
      <button type="button" disabled={quantityVariancePending} onClick={() => setOpen(true)}>登记线下生产完成</button>
      {quantityVariancePending ? <span className={actionStyles.warning}>交付数量差异申请待审批，审批后才能确认完工。</span> : null}
      {open ? <OfflineProductionCompletionDialog
        executionId={executionId}
        order={order}
        onChanged={onChanged}
        onSaved={onSaved}
        onClose={() => setOpen(false)}
      /> : null}
    </>
  );
}

function OfflineProductionCompletionDialog({
  executionId,
  order,
  onChanged,
  onSaved,
  onClose,
}: {
  executionId: string;
  order: FactoryPurchaseOrder;
  onChanged: () => void | Promise<void>;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const initialCompletedAt = useRef(shanghaiDateTimeInputValue()).current;
  const [channel, setChannel] = useState<OfflineFactoryConfirmationChannel | "">("");
  const [supplierContact, setSupplierContact] = useState("");
  const [productionCompletedAt, setProductionCompletedAt] = useState(initialCompletedAt);
  const [remark, setRemark] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const minCompletedAt = order.productionStartedAt ? shanghaiDateTimeInputValue(order.productionStartedAt) : undefined;
  const maxCompletedAt = shanghaiDateTimeInputValue();
  const dirty = Boolean(channel || supplierContact.trim() || remark.trim() || evidenceNote.trim() || evidenceFile)
    || productionCompletedAt !== initialCompletedAt;
  useWorkspaceTabBusy(saving);

  function validate() {
    if (!channel) return "请选择工厂完工确认渠道";
    if (!supplierContact.trim()) return "请填写工厂完工确认人";
    const completedIso = shanghaiDateTimeIso(productionCompletedAt);
    if (!completedIso) return "请选择工厂实际生产完成时间";
    const completedTime = new Date(completedIso).getTime();
    if (completedTime > Date.now()) return "工厂实际生产完成时间不能晚于当前时间";
    if (order.productionStartedAt && completedTime < new Date(order.productionStartedAt).getTime()) return "工厂实际生产完成时间不能早于开始生产时间";
    const evidenceError = validateConfirmationEvidenceFile(evidenceFile);
    if (evidenceError) return evidenceError;
    return "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const validationMessage = validate();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await apiJson<SavedCompletion>(
        `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/offline-production-completion`,
        {
          method: "POST",
          body: JSON.stringify({
            channel,
            supplierContact: supplierContact.trim(),
            productionCompletedAt: shanghaiDateTimeIso(productionCompletedAt),
            remark: remark.trim(),
            evidenceNote: evidenceNote.trim(),
            expectedRevision: Number(order.revision || 1),
          }),
        },
      );
      if (!result.success) throw new Error(result.message || "线下生产完成登记失败");
      const savedMessage = result.message || "线下生产完成已登记";
      const saved = result.data || result.result;
      let completionMessage = savedMessage;
      if (evidenceFile) {
        try {
          await uploadConfirmationEvidence({
            executionId,
            purchaseOrderId: order.id,
            eventKind: "PRODUCTION_COMPLETION",
            eventId: saved?.purchaseOrderId || order.id,
            file: evidenceFile,
          });
          completionMessage = `${savedMessage}，确认凭证已上传`;
        } catch (uploadError) {
          const reason = uploadError instanceof Error ? uploadError.message : "上传失败";
          completionMessage = `${savedMessage}，但确认凭证上传失败：${reason}；可在确认记录中稍后补传`;
        }
      }
      try {
        await onChanged();
      } catch {
        onSaved(`${completionMessage}；详情刷新失败，请重新打开执行单查看`);
        onClose();
        return;
      }
      onSaved(completionMessage);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "线下生产完成登记失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <DismissibleLayer
      ariaLabel="登记线下生产完成"
      overlayClassName={shell.modalOverlay}
      surfaceClassName={styles.dialog}
      onClose={onClose}
      dismissible={!saving}
      dismissConfirmMessage={dirty ? "线下完工信息尚未保存，确定关闭吗？" : ""}
    >
      {({ requestClose }) => <form className={styles.form} onSubmit={submit} inert={saving} aria-busy={saving}>
        <header className={styles.header}><div><h2>登记线下生产完成</h2><p>{order.poNo || order.purchaseOrderNo || "工厂采购单"} · 代录工厂通过系统外渠道发出的完工确认</p></div></header>
        <div className={styles.context}>保存后该采购单将进入“生产完成”，交期及金额基线随即冻结；实际完工时间与系统登记时间会分别保留。</div>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>确认渠道<select autoFocus value={channel} required onChange={(event) => setChannel(event.target.value as OfflineFactoryConfirmationChannel | "")}><option value="">请选择</option>{OFFLINE_FACTORY_CHANNELS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className={styles.field}>工厂完工确认人<input value={supplierContact} maxLength={100} required placeholder="姓名或可识别联系人" onChange={(event) => setSupplierContact(event.target.value)} /></label>
          <label className={styles.field}>工厂实际生产完成时间<input type="datetime-local" step={1} value={productionCompletedAt} min={minCompletedAt} max={maxCompletedAt} required onChange={(event) => setProductionCompletedAt(event.target.value)} /><small className={styles.hint}>按中国标准时间填写，不是本次代录时间。</small></label>
          <label className={`${styles.field} ${styles.full}`}>完工说明（选填）<textarea value={remark} maxLength={2000} placeholder="可记录完成范围、包装状态等补充信息" onChange={(event) => setRemark(event.target.value)} /></label>
          <label className={`${styles.field} ${styles.full}`}>依据说明（选填）<textarea value={evidenceNote} maxLength={2000} placeholder="例如：邮件主题、微信记录位置、纸质回执编号" onChange={(event) => setEvidenceNote(event.target.value)} /><small className={styles.hint}>建议填写便于后续追溯确认凭证的信息。</small></label>
          <label className={`${styles.field} ${styles.full}`}>确认凭证（选填）<input type="file" accept={CONFIRMATION_EVIDENCE_ACCEPT} onChange={(event) => { setEvidenceFile(event.target.files?.[0] || null); setError(""); }} /><small className={styles.hint}>支持 PDF、JPG、PNG、WebP，最大 10MB。完工状态会先保存；附件上传失败不会回滚完工确认。</small></label>
        </div>
        {error ? <div className={styles.error} role="alert" aria-live="assertive">{error}</div> : null}
        <div className={styles.actions}><button className={styles.secondaryButton} type="button" disabled={saving} onClick={requestClose}>取消</button><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "保存中..." : "确认生产已完成"}</button></div>
      </form>}
    </DismissibleLayer>
  );
}
