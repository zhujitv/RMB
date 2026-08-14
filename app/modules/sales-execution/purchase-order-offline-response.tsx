"use client";

import { useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import styles from "./offline-confirmation.module.css";
import {
  CONFIRMATION_EVIDENCE_ACCEPT,
  uploadConfirmationEvidence,
  validateConfirmationEvidenceFile,
} from "./confirmation-evidence-upload";
import {
  OFFLINE_FACTORY_CHANNELS,
  currentFactoryDeliveryDate,
  initialOfflineItemPrices,
  shanghaiDateTimeInputValue,
  shanghaiDateTimeIso,
  validOfflineUnitPrice,
  type OfflineFactoryConfirmationChannel,
  type OfflineFactoryResponseAction,
} from "./offline-confirmation-values";
import type { FactoryPurchaseOrder, PurchaseOrderItem } from "./types";

type SavedResponseData = { responseId?: string; confirmationEventKey?: string };
type SavedResponse = {
  success?: boolean;
  message?: string;
  data?: SavedResponseData;
  result?: SavedResponseData;
};

function itemDescription(item: PurchaseOrderItem, index: number) {
  const name = item.productNameSnapshot || item.productDescription || `明细 ${index + 1}`;
  return item.specificationSnapshot ? `${name} · ${item.specificationSnapshot}` : name;
}

function actionLabel(action: OfflineFactoryResponseAction) {
  if (action === "ACCEPTED") return "接受订单并确认交期";
  if (action === "DELIVERY_PROPOSED") return "提出新交期";
  return "拒绝订单";
}

export function PurchaseOrderOfflineResponse({
  executionId,
  shippingStarted,
  order,
  canManage,
  onChanged,
  onSaved,
}: {
  executionId: string;
  shippingStarted: boolean;
  order: FactoryPurchaseOrder;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
  onSaved: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const canRecord = canManage
    && !shippingStarted
    && !order.actualDeliveryDate
    && order.productionStatus !== "COMPLETED"
    && (order.status === "DISPATCHED" || order.status === "ACCEPTED");
  if (!canRecord) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        {order.status === "DISPATCHED" ? "登记线下工厂回复" : "登记线下改期"}
      </button>
      {open ? <OfflineResponseDialog
        executionId={executionId}
        order={order}
        onChanged={onChanged}
        onSaved={onSaved}
        onClose={() => setOpen(false)}
      /> : null}
    </>
  );
}

function OfflineResponseDialog({
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
  const defaultAction: OfflineFactoryResponseAction = order.status === "DISPATCHED" ? "ACCEPTED" : "DELIVERY_PROPOSED";
  const defaultDeliveryDate = defaultAction === "ACCEPTED" ? currentFactoryDeliveryDate(order) : "";
  const initialRespondedAt = useRef(shanghaiDateTimeInputValue()).current;
  const initialItemPrices = useRef(initialOfflineItemPrices(order)).current;
  const [action, setAction] = useState<OfflineFactoryResponseAction>(defaultAction);
  const [channel, setChannel] = useState<OfflineFactoryConfirmationChannel | "">("");
  const [supplierContact, setSupplierContact] = useState("");
  const [supplierRespondedAt, setSupplierRespondedAt] = useState(initialRespondedAt);
  const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate);
  const [remark, setRemark] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [itemPrices, setItemPrices] = useState<Record<string, string>>(initialItemPrices);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const currentDeliveryDate = currentFactoryDeliveryDate(order);
  const firstNonRejectResponse = Number(order.supplierResponseSequence || 0) === 0 && action !== "REJECTED";
  const minRespondedAt = order.dispatchedAt ? shanghaiDateTimeInputValue(order.dispatchedAt) : undefined;
  const maxRespondedAt = shanghaiDateTimeInputValue();
  const priceDirty = Object.entries(itemPrices).some(([itemId, price]) => price !== initialItemPrices[itemId]);
  const dirty = action !== defaultAction || Boolean(channel || supplierContact.trim() || remark.trim() || evidenceNote.trim() || evidenceFile)
    || supplierRespondedAt !== initialRespondedAt || deliveryDate !== defaultDeliveryDate || priceDirty;
  useWorkspaceTabBusy(saving);

  function selectAction(nextAction: OfflineFactoryResponseAction) {
    setAction(nextAction);
    setDeliveryDate(nextAction === "ACCEPTED" ? currentDeliveryDate : "");
    setError("");
  }

  function validate() {
    if (!channel) return "请选择工厂实际回复渠道";
    if (!supplierContact.trim()) return "请填写工厂实际回复人";
    const responseIso = shanghaiDateTimeIso(supplierRespondedAt);
    if (!responseIso) return "请选择工厂实际回复时间";
    const responseTime = new Date(responseIso).getTime();
    if (responseTime > Date.now()) return "工厂实际回复时间不能晚于当前时间";
    if (order.dispatchedAt && responseTime < new Date(order.dispatchedAt).getTime()) return "工厂实际回复时间不能早于采购单下发时间";
    if (action !== "REJECTED" && !deliveryDate) return "请填写工厂确认的交货日期";
    if (action === "DELIVERY_PROPOSED" && deliveryDate === currentDeliveryDate) return "新交期必须不同于当前生效交期";
    if ((action === "DELIVERY_PROPOSED" || action === "REJECTED") && !remark.trim()) return action === "REJECTED" ? "拒绝订单时必须填写原因" : "提出新交期时必须填写说明";
    const evidenceError = validateConfirmationEvidenceFile(evidenceFile);
    if (evidenceError) return evidenceError;
    if (firstNonRejectResponse) {
      const invalidIndex = (order.items || []).findIndex((item) => !item.id || !validOfflineUnitPrice(itemPrices[String(item.id)] || ""));
      if (invalidIndex >= 0) return `请填写第 ${invalidIndex + 1} 行有效的工厂确认单价`;
    }
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
      const result = await apiJson<SavedResponse>(
        `/api/sales-executions/${encodeURIComponent(executionId)}/purchase-orders/${encodeURIComponent(order.id)}/offline-response`,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            channel,
            supplierContact: supplierContact.trim(),
            supplierRespondedAt: shanghaiDateTimeIso(supplierRespondedAt),
            ...(action === "REJECTED" ? {} : { deliveryDate }),
            remark: remark.trim(),
            evidenceNote: evidenceNote.trim(),
            expectedRevision: Number(order.revision || 1),
            ...(firstNonRejectResponse ? {
              itemPrices: (order.items || []).map((item) => ({
                purchaseOrderItemId: String(item.id),
                unitPrice: itemPrices[String(item.id)]?.trim(),
              })),
            } : {}),
          }),
        },
      );
      if (!result.success) throw new Error(result.message || "线下工厂回复登记失败");
      const savedMessage = result.message || "线下工厂回复已登记";
      const saved = result.data || result.result;
      let completionMessage = savedMessage;
      if (evidenceFile) {
        try {
          if (!saved?.responseId) throw new Error("系统未返回确认记录编号");
          await uploadConfirmationEvidence({
            executionId,
            purchaseOrderId: order.id,
            eventKind: "SUPPLIER_RESPONSE",
            eventId: saved.responseId,
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
      setError(saveError instanceof Error ? saveError.message : "线下工厂回复登记失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <DismissibleLayer
      ariaLabel="登记线下工厂回复"
      overlayClassName={shell.modalOverlay}
      surfaceClassName={styles.dialog}
      onClose={onClose}
      dismissible={!saving}
      dismissConfirmMessage={dirty ? "线下回复信息尚未保存，确定关闭吗？" : ""}
    >
      {({ requestClose }) => <form className={styles.form} onSubmit={submit} inert={saving} aria-busy={saving}>
        <header className={styles.header}>
          <div><h2>{defaultAction === "ACCEPTED" ? "登记线下工厂回复" : "登记线下交期变更"}</h2><p>{order.poNo || order.purchaseOrderNo || "工厂采购单"} · 仅登记已通过系统外渠道收到的真实回复</p></div>
        </header>
        <div className={styles.context}>来源将由系统固定记录为“内部线下代录”；实际回复时间与系统登记时间会分别保留。</div>
        {order.status === "DISPATCHED" ? <fieldset className={styles.choiceFieldset}>
          <legend>工厂回复结果</legend>
          <div className={styles.choiceGrid}>{(["ACCEPTED", "DELIVERY_PROPOSED", "REJECTED"] as const).map((value) => <label className={styles.choice} key={value}><input type="radio" name="offline-response-action" value={value} checked={action === value} onChange={() => selectAction(value)} />{actionLabel(value)}</label>)}</div>
        </fieldset> : <div className={styles.context}>本次登记：工厂提出新的交货日期；保存后仍需内部确认。</div>}
        <div className={styles.fieldGrid}>
          <label className={styles.field}>回复渠道<select autoFocus value={channel} required onChange={(event) => setChannel(event.target.value as OfflineFactoryConfirmationChannel | "")}><option value="">请选择</option>{OFFLINE_FACTORY_CHANNELS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className={styles.field}>工厂实际回复人<input value={supplierContact} maxLength={100} required placeholder="姓名或可识别联系人" onChange={(event) => setSupplierContact(event.target.value)} /></label>
          <label className={styles.field}>工厂实际回复时间<input type="datetime-local" step={1} value={supplierRespondedAt} min={minRespondedAt} max={maxRespondedAt} required onChange={(event) => setSupplierRespondedAt(event.target.value)} /><small className={styles.hint}>按中国标准时间填写，不是本次代录时间。</small></label>
          {action !== "REJECTED" ? <label className={styles.field}>{action === "ACCEPTED" ? "工厂确认交期" : "工厂提出的新交期"}<input type="date" value={deliveryDate} required onChange={(event) => setDeliveryDate(event.target.value)} /></label> : null}
          <label className={`${styles.field} ${styles.full}`}>{action === "REJECTED" ? "拒绝原因" : action === "DELIVERY_PROPOSED" ? "改期说明" : "回复备注（选填）"}<textarea value={remark} maxLength={2000} required={action !== "ACCEPTED"} placeholder={action === "ACCEPTED" ? "可填写工厂补充说明" : "请记录工厂给出的原因或说明"} onChange={(event) => setRemark(event.target.value)} /></label>
          <label className={`${styles.field} ${styles.full}`}>依据说明（选填）<textarea value={evidenceNote} maxLength={2000} placeholder="例如：邮件主题、微信记录位置、纸质回执编号" onChange={(event) => setEvidenceNote(event.target.value)} /><small className={styles.hint}>建议填写便于后续追溯确认凭证的信息。</small></label>
          <label className={`${styles.field} ${styles.full}`}>确认凭证（选填）<input type="file" accept={CONFIRMATION_EVIDENCE_ACCEPT} onChange={(event) => { setEvidenceFile(event.target.files?.[0] || null); setError(""); }} /><small className={styles.hint}>支持 PDF、JPG、PNG、WebP，最大 10MB。业务确认会先保存；即使附件上传失败，也不会撤销已登记的回复。</small></label>
        </div>
        {firstNonRejectResponse ? <section className={styles.priceSection}>
          <div className={styles.priceHeader}><div><strong>工厂确认价格</strong><small>首次非拒绝回复需逐行确认；原采购价已预填，可按工厂回复修改。</small></div><small>{order.purchaseCurrency || order.currency || "CNY"}</small></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>产品</th><th>数量</th><th>下发采购价</th><th>工厂确认单价</th></tr></thead><tbody>{(order.items || []).map((item, index) => {
            const itemId = String(item.id || "");
            const price = itemPrices[itemId] || "";
            return <tr key={itemId || index}><td>{itemDescription(item, index)}</td><td>{String(item.allocatedQuantity ?? item.quantity ?? "-")} {item.unitSnapshot || ""}</td><td>{item.purchaseUnitPrice == null ? "待工厂填写" : String(item.purchaseUnitPrice)}</td><td><input aria-label={`第 ${index + 1} 行工厂确认单价`} inputMode="decimal" value={price} required className={price && !validOfflineUnitPrice(price) ? styles.invalid : undefined} onChange={(event) => setItemPrices((current) => ({ ...current, [itemId]: event.target.value }))} /></td></tr>;
          })}</tbody></table></div>
        </section> : null}
        {error ? <div className={styles.error} role="alert" aria-live="assertive">{error}</div> : null}
        <div className={styles.actions}><button className={styles.secondaryButton} type="button" disabled={saving} onClick={requestClose}>取消</button><button className={action === "REJECTED" ? styles.dangerButton : styles.primaryButton} type="submit" disabled={saving}>{saving ? "保存中..." : actionLabel(action)}</button></div>
      </form>}
    </DismissibleLayer>
  );
}
