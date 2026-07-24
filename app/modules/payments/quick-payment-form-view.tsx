import type { FormEvent } from "react";
import { moneyText } from "../../formatters";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import { customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import { orderLabel, paymentStatusOptions } from "./helpers";
import type { PaymentFieldErrors } from "./quick-payment-utils";
import { CURRENCIES, PAYMENT_TYPES, type PaymentOrderOption, type QuickPaymentForm } from "./types";

type QuickPaymentFormViewProps = {
  editing: boolean;
  form: QuickPaymentForm;
  selectedOrder?: PaymentOrderOption | null;
  selectedOrderMeta: Array<{ label: string; value: string }>;
  currencyLocked: boolean;
  exchangeMeta: string;
  fieldErrors: PaymentFieldErrors;
  message: string;
  saving: boolean;
  canConfirmArrived: boolean;
  searchOrders: (keyword: string) => Promise<PaymentOrderOption[]>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onOrderSelect: (order: PaymentOrderOption) => void;
  onPaymentDateChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onExchangeRateChange: (value: string) => void;
  onFieldChange: <K extends keyof QuickPaymentForm>(key: K, value: QuickPaymentForm[K]) => void;
};

export function QuickPaymentFormView({
  editing, form, selectedOrder, selectedOrderMeta, currencyLocked, exchangeMeta,
  fieldErrors, message, saving, canConfirmArrived, searchOrders, onSubmit,
  onCancel, onOrderSelect, onPaymentDateChange, onCurrencyChange,
  onExchangeRateChange, onFieldChange,
}: QuickPaymentFormViewProps) {
  return (
    <form className={styles.quickCreatePanel} onSubmit={onSubmit} noValidate inert={saving} aria-busy={saving}>
      <div className={styles.quickCreateHeader}>
        <div><strong>{editing ? "编辑收款" : "快速登记收款"}</strong></div>
      </div>
      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            cacheKey="payment-orders"
            emptyLabel="未找到应收订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={(order) => `${customerLegalName(order)}${order.currency ? ` · ${order.currency}` : ""}${order.outstandingCny != null ? ` · 未收 ${moneyText(order.currency || "CNY", order.outstandingAmount, order.outstandingCny)}` : ""}`}
            search={searchOrders}
            onSelect={onOrderSelect}
          />
          {fieldErrors.orderId ? <small className={styles.inlineError}>{fieldErrors.orderId}</small> : null}
        </label>
        <label>收款日期
          <input type="date" value={form.paymentDate} onChange={(event) => onPaymentDateChange(event.target.value)} aria-invalid={Boolean(fieldErrors.paymentDate)} />
          {fieldErrors.paymentDate ? <small className={styles.inlineError}>{fieldErrors.paymentDate}</small> : null}
        </label>
        <label>收款类型
          <select value={form.paymentType} onChange={(event) => onFieldChange("paymentType", event.target.value)}>
            <option value="">请选择收款类型</option>
            {PAYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          {fieldErrors.paymentType ? <small className={styles.inlineError}>{fieldErrors.paymentType}</small> : null}
        </label>
        <label>收款金额
          <input value={form.amount} onChange={(event) => onFieldChange("amount", event.target.value)} inputMode="decimal" aria-invalid={Boolean(fieldErrors.amount)} />
          {fieldErrors.amount ? <small className={styles.inlineError}>{fieldErrors.amount}</small> : null}
        </label>
        <label>币种
          <select value={form.currency} onChange={(event) => onCurrencyChange(event.target.value)} disabled={currencyLocked}>
            <option value="">请选择币种</option>
            {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
          {fieldErrors.currency ? <small className={styles.inlineError}>{fieldErrors.currency}</small> : null}
        </label>
        <label>汇率
          <input
            value={form.exchangeRate}
            onChange={(event) => onExchangeRateChange(event.target.value)}
            readOnly={form.currency === "CNY"}
            inputMode="decimal"
            aria-invalid={Boolean(fieldErrors.exchangeRate)}
          />
          {fieldErrors.exchangeRate ? <small className={styles.inlineError}>{fieldErrors.exchangeRate}</small> : null}
        </label>
        <label>收款状态
          <select value={form.status} onChange={(event) => onFieldChange("status", event.target.value)}>
            {paymentStatusOptions(canConfirmArrived).map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>银行流水号
          <input value={form.bankReference} onChange={(event) => onFieldChange("bankReference", event.target.value)} placeholder="可选" />
        </label>
        <label>备注
          <input value={form.remark} onChange={(event) => onFieldChange("remark", event.target.value)} placeholder="可选" />
        </label>
      </div>

      <div className={styles.quickCreateMeta}>
        {selectedOrderMeta.length ? selectedOrderMeta.map((item) => (
          <span key={item.label}>{item.label}：{item.value}</span>
        )) : <span>订单：-</span>}
        {currencyLocked ? <span>收款币种已锁定为订单币种，不能混用其它币种。</span> : null}
        <span>{exchangeMeta || "汇率来源：待获取"}</span>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : editing ? "更新收款" : "保存收款"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}
