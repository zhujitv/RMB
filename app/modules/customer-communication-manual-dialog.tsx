import type { FormEvent } from "react";
import { DismissibleLayer } from "../components";
import styles from "../WorkspaceShell.module.css";
import type { ManualMarkDialogState } from "./customer-communication-utils";

const MANUAL_SEND_METHOD_OPTIONS = ["系统邮件", "手动邮件", "微信", "QQ", "WhatsApp", "客户平台", "其它"];

export function ManualMarkDialog({
  state,
  error,
  busy,
  onChange,
  onSubmit,
  onClose,
}: {
  state: ManualMarkDialogState;
  error: string;
  busy: boolean;
  onChange: (state: ManualMarkDialogState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <DismissibleLayer
      ariaLabel="手动标记已发送"
      overlayClassName={styles.modalOverlay}
      surfaceClassName={styles.modalCard}
      onClose={onClose}
      dismissible={!busy}
      dismissConfirmMessage="当前标记内容尚未提交，确定关闭吗？"
    >
      {({ requestClose }) => (
        <form className={styles.workspaceModalForm} onSubmit={onSubmit} inert={busy} aria-busy={busy}>
          <div className={styles.modalHeader}>
            <div>
              <strong>手动标记已发送</strong>
              <small>{state.row.orderNo || "-"} · {state.row.customerShortName || "-"}</small>
            </div>
            <button className={styles.ghostButton} type="button" disabled={busy} onClick={requestClose}>关闭</button>
          </div>
          {error ? <div className={styles.inlineError}>{error}</div> : null}
          <div className={styles.shippingDocsFormGrid}>
            <label>发送方式
              <select value={state.deliveryMethod} onChange={(event) => onChange({ ...state, deliveryMethod: event.target.value })} required>
                {MANUAL_SEND_METHOD_OPTIONS.map((method) => <option key={method} value={method}>{method}</option>)}
              </select>
            </label>
            <label>发送时间
              <input type="datetime-local" value={state.sentAt} onChange={(event) => onChange({ ...state, sentAt: event.target.value })} required />
            </label>
            <label className={styles.shippingDocsWideField}>备注
              <textarea value={state.remark} onChange={(event) => onChange({ ...state, remark: event.target.value })} rows={4} placeholder="可填写微信、QQ、客户平台记录编号或人工邮件说明" />
            </label>
          </div>
          <div className={styles.modalFooter}>
            <button className={styles.secondaryButton} type="button" disabled={busy} onClick={requestClose}>取消</button>
            <button className={styles.primaryButtonCompact} type="submit" disabled={busy}>{busy ? "提交中..." : "确认标记"}</button>
          </div>
        </form>
      )}
    </DismissibleLayer>
  );
}
