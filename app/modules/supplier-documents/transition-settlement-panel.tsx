"use client";

import styles from "../../WorkspaceShell.module.css";
import type { TransitionSettlementForm } from "./use-transition-settlement-form";

export function TransitionSettlementPanel({ cost, saving, form, onError }: {
  cost: { id: string; currency?: string; amount?: number };
  saving: boolean;
  form: TransitionSettlementForm;
  onError: (message: string) => void;
}) {
  async function load() {
    onError("");
    try {
      await form.load(cost.id);
    } catch (error) {
      onError(error instanceof Error ? error.message : "读取过渡结算报关商品失败");
    }
  }

  return (
    <section className={styles.supplierDocumentUploadCard} aria-label="历史过渡结算">
      <div className={styles.supplierDocumentUploadHeader}>
        <strong>历史过渡结算</strong>
        <span className={styles.statusPill}>{form.preview?.existing ? "已确认冻结" : "需管理员确认"}</span>
      </div>
      <div className={styles.supplierDocumentUploadBody}>
        <p>该成本不是由新工厂采购最终结算生成。系统将保留现有应收、发货和报关资料，只补建可审计的过渡结算凭证。</p>
        {!form.preview ? <button className={styles.secondaryButton} type="button" disabled={saving || form.loading} onClick={load}>{form.loading ? "读取报关单中..." : "读取报关商品"}</button> : null}
        {form.preview ? <>
          <p>报关单号：{form.preview.customsDeclarationNo || "已锁定原报关单"}　现有成本：{cost.currency || "CNY"} {Number(cost.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</p>
          <div className={styles.tableScroll}><table className={styles.compactTable}>
            <thead><tr><th>选择</th><th>报关项号</th><th>品名</th><th>报关数量</th><th>本工厂数量</th><th>单位</th><th>含税单价</th></tr></thead>
            <tbody>{form.items.map((item, index) => <tr key={`${item.customsItemIndex}-${index}`}>
              <td><input aria-label={`选择第${index + 1}行报关商品`} type="checkbox" checked={Boolean(item.selected)} disabled={Boolean(form.preview?.existing)} onChange={(event) => form.updateItem(index, { selected: event.target.checked })} /></td>
              <td>{item.customsItemNo || index + 1}</td>
              <td><input aria-label={`过渡结算第${index + 1}行品名`} value={item.productName || ""} disabled={Boolean(form.preview?.existing)} onChange={(event) => form.updateItem(index, { productName: event.target.value })} /></td>
              <td>{item.declaredQuantity || "-"}</td>
              <td><input aria-label={`过渡结算第${index + 1}行数量`} inputMode="decimal" value={item.quantity || ""} disabled={Boolean(form.preview?.existing)} onChange={(event) => form.updateItem(index, { quantity: event.target.value })} /></td>
              <td><input aria-label={`过渡结算第${index + 1}行单位`} value={item.unit || ""} disabled={Boolean(form.preview?.existing)} onChange={(event) => form.updateItem(index, { unit: event.target.value })} /></td>
              <td><input aria-label={`过渡结算第${index + 1}行含税单价`} inputMode="decimal" value={item.unitPriceWithTax || ""} disabled={Boolean(form.preview?.existing)} onChange={(event) => form.updateItem(index, { unitPriceWithTax: event.target.value })} /></td>
            </tr>)}</tbody>
          </table></div>
          {(form.preview.warnings || []).map((warning) => <div className={styles.inlineError} key={warning}>{warning}</div>)}
          {!form.preview.existing ? <>
            <div className={styles.reportFilterGrid}>
              <label>增加费用<input inputMode="decimal" value={form.increaseAmount} onChange={(event) => form.setIncreaseAmount(event.target.value)} /></label>
              <label>扣减金额<input inputMode="decimal" value={form.decreaseAmount} onChange={(event) => form.setDecreaseAmount(event.target.value)} /></label>
              <label className={styles.supplierDocumentRequestMessage}>过渡原因<textarea rows={3} maxLength={1000} value={form.reason} onChange={(event) => form.setReason(event.target.value)} placeholder="例：新采购流程上线前已发货并完成报关" /></label>
            </div>
            <label><input type="checkbox" checked={form.confirmed} onChange={(event) => form.setConfirmed(event.target.checked)} /> 我已核对原始凭证，确认该订单已发货报关，上述数量和金额为真实过渡数据。</label>
          </> : <p>该过渡结算凭证已冻结，本次将直接重建资料回传合同草稿。</p>}
        </> : null}
      </div>
    </section>
  );
}
