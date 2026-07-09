import type { FormEvent } from "react";
import { CustomerAutocomplete } from "../../CustomerAutocomplete";
import styles from "../../WorkspaceShell.module.css";
import {
  CURRENCIES,
  ORDER_STATUSES,
  PAYMENT_TERMS,
  TRADE_TERMS,
  type OrderRow,
} from "./model";
import {
  LogisticsSupplierField,
  OrderAssignmentFields,
  PaymentInstallmentsEditor,
} from "./quick-order-fields";
import { useQuickOrderPanelController } from "./quick-order-panel-controller";

export function QuickCreateOrderPanel({
  initialOrder,
  canManageOrderAssignments = false,
  onOpenExchangeSettings,
  onCancel,
  onSaved,
}: {
  initialOrder?: OrderRow | null;
  canManageOrderAssignments?: boolean;
  onOpenExchangeSettings?: () => void;
  onCancel: () => void;
  onSaved: (order?: OrderRow | null) => void;
}) {
  const controller = useQuickOrderPanelController({
    initialOrder,
    canManageOrderAssignments,
    onOpenExchangeSettings,
    onSaved,
  });

  function submitQuickOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.submitQuickOrder();
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={submitQuickOrder}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{initialOrder?.id ? "编辑应收订单" : "新建应收订单"}</strong>
        </div>
      </div>

      {controller.message ? <div className={styles.inlineError}>{controller.message}</div> : null}
      {controller.historicalDateNotice ? <div className={styles.infoStrip}>{controller.historicalDateNotice}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label className={styles.autocompleteField}>
          客户搜索
          <CustomerAutocomplete
            value={controller.customer || null}
            onSelect={(selected) => void controller.handleCustomerSelect(selected)}
            onCreateRequested={(name) => controller.setMessage(`请先到系统设置 > 客户资料中新建客户：${name}`)}
          />
        </label>
        <label>
          订单号
          <input value={controller.form.orderNo} onChange={(event) => controller.setFormValue("orderNo", event.target.value)} placeholder="例如 PV263" required />
        </label>
        <label>
          提单号
          <input value={controller.form.blNo} onChange={(event) => controller.setFormValue("blNo", event.target.value)} placeholder="可稍后补充" />
        </label>
        <label>
          业务主体
          <select value={controller.form.businessEntityId} onChange={(event) => controller.setFormValue("businessEntityId", event.target.value)} disabled={Boolean(initialOrder?.id)}>
            <option value="">使用系统默认业务主体</option>
            {controller.businessEntities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.displayName || entity.shortName || entity.name}{entity.isDefault ? " · 默认" : ""}
              </option>
            ))}
          </select>
          {initialOrder?.id ? <small className={styles.mutedText}>已有订单需通过详情里的业务主体转移操作修改。</small> : null}
        </label>
        <label>
          订单状态
          <select value={controller.form.status} onChange={(event) => controller.setFormValue("status", event.target.value)}>
            {ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        {canManageOrderAssignments ? (
          <OrderAssignmentFields
            form={controller.form}
            salespeople={controller.salespeople}
            onSalespersonChange={(nextSalespersonUserId) => controller.setForm((current) => ({
              ...current,
              salespersonUserId: nextSalespersonUserId,
            }))}
          />
        ) : null}
        <label>
          币种
          <select value={controller.form.currency} onChange={(event) => void controller.handleCurrencyChange(event.target.value)}>
            <option value="">请选择币种</option>
            {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        <label className={styles.exchangeRateField}>
          汇率
          <div className={styles.exchangeRateInputRow}>
            <input
              value={controller.form.exchangeRate}
              readOnly
              placeholder={controller.form.currency === "CNY" ? "CNY 自动为 1" : "点击刷新官方汇率"}
              inputMode="decimal"
              required
            />
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={controller.refreshingExchangeRate || controller.form.currency === "CNY"}
              onClick={() => void controller.refreshOfficialExchangeRate()}
            >
              {controller.refreshingExchangeRate ? "读取中..." : "刷新官方汇率"}
            </button>
          </div>
          {controller.exchangeCacheMissing ? (
            <small className={styles.exchangeRateHint}>
              当前币种暂无官方汇率缓存，请到系统设置刷新汇率。
              {controller.onOpenExchangeSettings ? (
                <button className={styles.inlineLinkButton} type="button" onClick={controller.onOpenExchangeSettings}>
                  前往系统设置刷新汇率
                </button>
              ) : null}
            </small>
          ) : null}
        </label>
        <label>
          预计应收金额
          <input value={controller.form.estimatedReceivableAmount} onChange={(event) => controller.setFormValue("estimatedReceivableAmount", event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          最终应收金额
          <input value={controller.form.finalReceivableAmount} onChange={(event) => controller.setFormValue("finalReceivableAmount", event.target.value)} inputMode="decimal" placeholder="为空则等于实际/预计应收" />
        </label>
        <label>
          实际发货金额
          <input value={controller.form.actualShipmentAmount} onChange={(event) => controller.setFormValue("actualShipmentAmount", event.target.value)} inputMode="decimal" placeholder="可发货后补录" />
        </label>
        <label>
          发货时间
          <input value={controller.form.actualShipmentDate} onChange={(event) => controller.setFormValue("actualShipmentDate", event.target.value)} type="date" />
        </label>
        <label>
          贸易条款
          <select value={controller.form.tradeTerm} onChange={(event) => controller.setFormValue("tradeTerm", event.target.value)}>
            {TRADE_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
          </select>
        </label>
        <label>
          付款条款
          <select value={controller.form.paymentTermType} onChange={(event) => controller.setFormValue("paymentTermType", event.target.value)}>
            {PAYMENT_TERMS.map((term) => <option key={term.value} value={term.value}>{term.label}</option>)}
          </select>
        </label>
        {["OA", "AFTER_ARRIVAL"].includes(controller.form.paymentTermType) ? (
          <label>
            账期天数
            <input value={controller.form.creditDays} onChange={(event) => controller.setFormValue("creditDays", event.target.value)} inputMode="numeric" required />
          </label>
        ) : null}
        <label>
          提单日期
          <input value={controller.form.blDate} onChange={(event) => controller.setFormValue("blDate", event.target.value)} type="date" />
        </label>
        <label>
          预计到港日期
          <input value={controller.form.expectedArrivalDate} onChange={(event) => controller.setFormValue("expectedArrivalDate", event.target.value)} type="date" required={controller.form.paymentTermType === "AFTER_ARRIVAL"} />
        </label>
        <label>
          预计收款日期
          <input value={controller.form.expectedPaymentDate} onChange={(event) => controller.setFormValue("expectedPaymentDate", event.target.value)} type="date" />
        </label>
        <label>
          到期日
          <input value={controller.form.dueDate} onChange={(event) => controller.setFormValue("dueDate", event.target.value)} type="date" readOnly={controller.form.paymentTermType !== "INSTALLMENT"} />
        </label>
        <label>
          提醒天数
          <input value={controller.form.reminderDays} onChange={(event) => controller.setFormValue("reminderDays", event.target.value)} inputMode="numeric" />
        </label>
        <LogisticsSupplierField
          allowMultipleLogisticsSuppliers={controller.allowMultipleLogisticsSuppliers}
          defaultLogisticsSupplier={controller.defaultLogisticsSupplier}
          form={controller.form}
          isExwOrder={controller.isExwOrder}
          logisticsSuppliers={controller.logisticsSuppliers}
          selectedIds={controller.selectedLogisticsSupplierIds()}
          setFormValue={controller.setFormValue}
        />
        {controller.form.paymentTermType === "INSTALLMENT" ? (
          <PaymentInstallmentsEditor rows={controller.form.paymentInstallments} onChange={(paymentInstallments) => controller.setFormValue("paymentInstallments", paymentInstallments)} />
        ) : null}
        <label className={styles.autocompleteField}>
          备注
          <input value={controller.form.remark} onChange={(event) => controller.setFormValue("remark", event.target.value)} placeholder="可选" />
        </label>
      </div>

      <div className={styles.quickCreateMeta}>
        <span>客户全称：{controller.customer?.name || controller.customer?.fullName || "-"}</span>
        <span>{controller.exchangeMeta || "汇率来源：待获取"}</span>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={controller.saving}>{controller.saving ? "保存中..." : initialOrder?.id ? "更新订单" : "保存订单"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={controller.saving}>取消</button>
      </div>
    </form>
  );
}
