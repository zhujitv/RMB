
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api";
import { CustomerAutocomplete, type CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import { customerDisplayName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import {
  CURRENCIES,
  LOGISTICS_SUPPLIER_TYPES,
  ORDER_STATUSES,
  PAYMENT_TERMS,
  TRADE_TERMS,
  emptyQuickOrderForm,
  type ExchangeRateResponse,
  type QuickOrderForm,
  type SettingsResponse,
  type SuppliersResponse,
  type OrderRow,
  type PaymentInstallment,
  type SupplierOption,
} from "./model";
import {
  derivedDueDate,
  installmentTotal,
  orderFormFromRow,
  supplierName,
} from "./utils";

export function QuickCreateOrderPanel({
  initialOrder,
  onCancel,
  onSaved,
}: {
  initialOrder?: OrderRow | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<QuickOrderForm>(() => orderFormFromRow(initialOrder));
  const [customers, setCustomers] = useState<CustomerAutocompleteOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [allowMultipleLogisticsSuppliers, setAllowMultipleLogisticsSuppliers] = useState(false);
  const [exchangeMeta, setExchangeMeta] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const logisticsSuppliers = useMemo(() => (
    suppliers.filter((supplier) => supplier.status !== "停用" && LOGISTICS_SUPPLIER_TYPES.includes(supplier.supplierType || ""))
  ), [suppliers]);
  const defaultLogisticsSupplier = useMemo(() => (
    logisticsSuppliers.find((supplier) => supplier.isDefaultLogisticsSupplier) || null
  ), [logisticsSuppliers]);

  useEffect(() => {
    setForm(orderFormFromRow(initialOrder));
    setMessage("");
    if (initialOrder?.currency) {
      setExchangeMeta(initialOrder.currency === "CNY"
        ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000"
        : initialOrder.exchangeRate
          ? `当前订单汇率：${Number(initialOrder.exchangeRate).toFixed(4)}`
          : "汇率来源：待获取，请手工填写");
    } else {
      setExchangeMeta("");
    }
  }, [initialOrder?.id]);

  useEffect(() => {
    void loadFormOptions();
  }, []);

  useEffect(() => {
    if (allowMultipleLogisticsSuppliers) return;
    if (!defaultLogisticsSupplier) return;
    setForm((current) => ({
      ...current,
      logisticsSupplierIds: [defaultLogisticsSupplier.id],
    }));
  }, [allowMultipleLogisticsSuppliers, defaultLogisticsSupplier?.id]);

  useEffect(() => {
    if (form.paymentTermType === "INSTALLMENT") return;
    const nextDueDate = derivedDueDate(form);
    if (nextDueDate !== form.dueDate) setFormValue("dueDate", nextDueDate);
  }, [form.paymentTermType, form.actualShipmentDate, form.blDate, form.expectedArrivalDate, form.creditDays]);

  async function loadFormOptions() {
    try {
      const [settingsResult, suppliersResult] = await Promise.all([
        apiJson<SettingsResponse>("/api/exchange-rates/settings").catch(() => null),
        apiJson<SuppliersResponse>("/api/suppliers/available").catch(() => null),
      ]);
      setAllowMultipleLogisticsSuppliers(Boolean(settingsResult?.settings?.allowMultipleOrderLogisticsSuppliers));
      setSuppliers(Array.isArray(suppliersResult?.suppliers) ? suppliersResult.suppliers : []);
    } catch (optionError) {
      setMessage(optionError instanceof Error ? optionError.message : "读取订单配置失败");
    }
  }

  async function resolveExchangeRate(currency: string) {
    const normalized = currency.trim().toUpperCase();
    if (!normalized) {
      setExchangeMeta("");
      setForm((current) => ({
        ...current,
        exchangeRate: "",
        exchangeRateDate: "",
        exchangeRateSource: "",
        exchangeRateType: "",
      }));
      return;
    }
    if (normalized === "CNY") {
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setForm((current) => ({
        ...current,
        exchangeRate: "1",
        exchangeRateDate: "",
        exchangeRateSource: "系统",
        exchangeRateType: "人民币",
      }));
      return;
    }
    setExchangeMeta("正在获取汇率...");
    try {
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?currency=${encodeURIComponent(normalized)}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setForm((current) => ({
          ...current,
          exchangeRate: String(rate),
          exchangeRateDate: result.rate?.rateDate || "",
          exchangeRateSource: result.rate?.source || "",
          exchangeRateType: result.rate?.rateType || "",
        }));
        setExchangeMeta(`来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`);
      } else {
        setExchangeMeta("汇率来源：待获取，请手工填写");
      }
    } catch (rateError) {
      setExchangeMeta(rateError instanceof Error ? rateError.message : "汇率获取失败，请手工填写");
    }
  }

  function setFormValue<K extends keyof QuickOrderForm>(key: K, value: QuickOrderForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const initialCustomer = useMemo(() => {
    if (!initialOrder?.customerId) return null;
    return {
      id: initialOrder.customerId,
      name: initialOrder.customerFullName || initialOrder.customerName,
      fullName: initialOrder.customerFullName || initialOrder.customerName,
      shortName: initialOrder.customerShortName,
      displayName: customerDisplayName(initialOrder),
      defaultCurrency: initialOrder.currency,
    } satisfies CustomerAutocompleteOption;
  }, [
    initialOrder?.currency,
    initialOrder?.customerFullName,
    initialOrder?.customerId,
    initialOrder?.customerName,
    initialOrder?.customerShortName,
  ]);

  const customerOptions = useMemo(() => {
    if (!initialCustomer) return customers;
    return customers.some((customer) => customer.id === initialCustomer.id)
      ? customers
      : [initialCustomer, ...customers];
  }, [customers, initialCustomer]);
  const customer = customerOptions.find((option) => option.id === form.customerId);

  async function handleCustomerSelect(customerOption: CustomerAutocompleteOption) {
    setCustomers((current) => current.some((item) => item.id === customerOption.id) ? current : [customerOption, ...current]);
    setForm((current) => ({
      ...current,
      customerId: customerOption.id,
      currency: customerOption.defaultCurrency || current.currency,
      exchangeRate: customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRate,
      exchangeRateDate: customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateDate,
      exchangeRateSource: customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateSource,
      exchangeRateType: customerOption.defaultCurrency && customerOption.defaultCurrency !== current.currency ? "" : current.exchangeRateType,
      paymentTermType: customerOption.defaultPaymentTermType || current.paymentTermType,
      tradeTerm: customerOption.defaultTradeTerm || current.tradeTerm,
    }));
    if (customerOption.defaultCurrency) await resolveExchangeRate(customerOption.defaultCurrency);
  }

  async function handleCurrencyChange(currency: string) {
    const normalized = currency.toUpperCase();
    setForm((current) => ({
      ...current,
      currency: normalized,
      exchangeRate: "",
      exchangeRateDate: "",
      exchangeRateSource: "",
      exchangeRateType: "",
    }));
    await resolveExchangeRate(normalized);
  }

  function handleExchangeRateChange(value: string) {
    setForm((current) => ({
      ...current,
      exchangeRate: value,
      ...(current.currency && current.currency !== "CNY"
        ? { exchangeRateSource: "手动" }
        : {}),
    }));
    if (form.currency && form.currency !== "CNY") {
      setExchangeMeta(`来源：手动 ｜ 类型：${form.exchangeRateType || "手动录入"} ｜ 汇率：${value || "-"}`);
    }
  }

  function setInstallment(index: number, key: keyof PaymentInstallment, value: string) {
    setForm((current) => ({
      ...current,
      paymentInstallments: current.paymentInstallments.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [key]: value } : row
      )),
    }));
  }

  function addInstallment() {
    setForm((current) => ({
      ...current,
      paymentInstallments: [...current.paymentInstallments, { ratio: "", condition: "" }],
    }));
  }

  function removeInstallment(index: number) {
    setForm((current) => ({
      ...current,
      paymentInstallments: current.paymentInstallments.filter((_, rowIndex) => rowIndex !== index).length
        ? current.paymentInstallments.filter((_, rowIndex) => rowIndex !== index)
        : [{ ratio: "100", condition: "按约定付款" }],
    }));
  }

  function selectedLogisticsSupplierIds() {
    if (!allowMultipleLogisticsSuppliers) return defaultLogisticsSupplier ? [defaultLogisticsSupplier.id] : [];
    return form.logisticsSupplierIds;
  }

  async function submitQuickOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.customerId) return setMessage("请选择客户");
    if (!form.orderNo.trim()) return setMessage("请填写订单号");
    if (!form.currency) return setMessage("请选择币种");
    if (!Number(form.exchangeRate)) return setMessage("请填写汇率；CNY 订单汇率应自动为 1");
    if (!form.estimatedReceivableAmount || Number(form.estimatedReceivableAmount) <= 0) return setMessage("请填写预计应收金额");
    if (form.paymentTermType === "AFTER_ARRIVAL" && !form.expectedArrivalDate) return setMessage("到港后付款请填写预计到港日期");
    if (["OA", "AFTER_ARRIVAL"].includes(form.paymentTermType) && Number(form.creditDays) < 0) return setMessage("请填写有效账期天数");
    if (form.paymentTermType === "INSTALLMENT" && installmentTotal(form.paymentInstallments) !== 100) return setMessage("分批付款比例合计必须等于 100%");
    if (!allowMultipleLogisticsSuppliers && !defaultLogisticsSupplier) return setMessage("请先在供应商资料中设置默认物流供应商");

    setSaving(true);
    setMessage("");
    try {
      const payload = {
        customerId: form.customerId,
        orderNo: form.orderNo.trim(),
        blNo: form.blNo.trim(),
        currency: form.currency,
        exchangeRate: Number(form.exchangeRate),
        exchangeRateDate: form.exchangeRateDate || undefined,
        exchangeRateSource: form.exchangeRateSource || undefined,
        exchangeRateType: form.exchangeRateType || undefined,
        estimatedReceivableAmount: Number(form.estimatedReceivableAmount),
        finalReceivableAmount: form.finalReceivableAmount ? Number(form.finalReceivableAmount) : undefined,
        actualShipmentAmount: form.actualShipmentAmount ? Number(form.actualShipmentAmount) : undefined,
        actualShipmentDate: form.actualShipmentDate || undefined,
        tradeTerm: form.tradeTerm,
        paymentTermType: form.paymentTermType,
        blDate: form.blDate || undefined,
        expectedArrivalDate: form.expectedArrivalDate || undefined,
        expectedPaymentDate: form.expectedPaymentDate || undefined,
        dueDate: form.dueDate || undefined,
        creditDays: ["OA", "AFTER_ARRIVAL"].includes(form.paymentTermType) ? Number(form.creditDays || 0) : undefined,
        paymentInstallments: form.paymentTermType === "INSTALLMENT"
          ? form.paymentInstallments.map((row) => ({ ratio: Number(row.ratio), condition: row.condition.trim() }))
          : undefined,
        reminderDays: Number(form.reminderDays || 7),
        status: form.status,
        logisticsSupplierIds: selectedLogisticsSupplierIds(),
        remark: form.remark.trim(),
      };
      const isEdit = Boolean(initialOrder?.id);
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/orders/${encodeURIComponent(initialOrder?.id || "")}` : "/api/orders",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      if (result.success !== true) throw new Error(result.message || "订单保存失败");
      setForm({ ...emptyQuickOrderForm });
      setExchangeMeta("");
      onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "订单保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.quickCreatePanel} onSubmit={submitQuickOrder}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{initialOrder?.id ? "编辑应收订单" : "新建应收订单"}</strong>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label className={styles.autocompleteField}>
          客户搜索
          <CustomerAutocomplete
            value={customer || null}
            onSelect={(selected) => void handleCustomerSelect(selected)}
            onCreateRequested={(name) => setMessage(`请先到系统设置 > 客户资料中新建客户：${name}`)}
          />
        </label>
        <label>
          订单号
          <input value={form.orderNo} onChange={(event) => setFormValue("orderNo", event.target.value)} placeholder="例如 PV263" required />
        </label>
        <label>
          提单号
          <input value={form.blNo} onChange={(event) => setFormValue("blNo", event.target.value)} placeholder="可稍后补充" />
        </label>
        <label>
          订单状态
          <select value={form.status} onChange={(event) => setFormValue("status", event.target.value)}>
            {ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          币种
          <select value={form.currency} onChange={(event) => void handleCurrencyChange(event.target.value)}>
            <option value="">请选择币种</option>
            {CURRENCIES.filter(Boolean).map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        <label>
          汇率
          <input value={form.exchangeRate} onChange={(event) => handleExchangeRateChange(event.target.value)} readOnly={form.currency === "CNY"} placeholder="自动获取或手工填写" inputMode="decimal" required />
        </label>
        <label>
          预计应收金额
          <input value={form.estimatedReceivableAmount} onChange={(event) => setFormValue("estimatedReceivableAmount", event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          最终应收金额
          <input value={form.finalReceivableAmount} onChange={(event) => setFormValue("finalReceivableAmount", event.target.value)} inputMode="decimal" placeholder="为空则等于实际/预计应收" />
        </label>
        <label>
          实际发货金额
          <input value={form.actualShipmentAmount} onChange={(event) => setFormValue("actualShipmentAmount", event.target.value)} inputMode="decimal" placeholder="可发货后补录" />
        </label>
        <label>
          发货时间
          <input value={form.actualShipmentDate} onChange={(event) => setFormValue("actualShipmentDate", event.target.value)} type="date" />
        </label>
        <label>
          贸易条款
          <select value={form.tradeTerm} onChange={(event) => setFormValue("tradeTerm", event.target.value)}>
            {TRADE_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
          </select>
        </label>
        <label>
          付款条款
          <select value={form.paymentTermType} onChange={(event) => setFormValue("paymentTermType", event.target.value)}>
            {PAYMENT_TERMS.map((term) => <option key={term.value} value={term.value}>{term.label}</option>)}
          </select>
        </label>
        {["OA", "AFTER_ARRIVAL"].includes(form.paymentTermType) ? (
          <label>
            账期天数
            <input value={form.creditDays} onChange={(event) => setFormValue("creditDays", event.target.value)} inputMode="numeric" required />
          </label>
        ) : null}
        <label>
          提单日期
          <input value={form.blDate} onChange={(event) => setFormValue("blDate", event.target.value)} type="date" />
        </label>
        <label>
          预计到港日期
          <input value={form.expectedArrivalDate} onChange={(event) => setFormValue("expectedArrivalDate", event.target.value)} type="date" required={form.paymentTermType === "AFTER_ARRIVAL"} />
        </label>
        <label>
          预计收款日期
          <input value={form.expectedPaymentDate} onChange={(event) => setFormValue("expectedPaymentDate", event.target.value)} type="date" />
        </label>
        <label>
          到期日
          <input value={form.dueDate} onChange={(event) => setFormValue("dueDate", event.target.value)} type="date" readOnly={form.paymentTermType !== "INSTALLMENT"} />
        </label>
        <label>
          提醒天数
          <input value={form.reminderDays} onChange={(event) => setFormValue("reminderDays", event.target.value)} inputMode="numeric" />
        </label>
        <label className={styles.autocompleteField}>
          物流供应商
          <select
            multiple={allowMultipleLogisticsSuppliers}
            size={allowMultipleLogisticsSuppliers ? 4 : 1}
            value={allowMultipleLogisticsSuppliers ? form.logisticsSupplierIds : (selectedLogisticsSupplierIds()[0] || "")}
            disabled={!allowMultipleLogisticsSuppliers}
            onChange={(event) => setFormValue("logisticsSupplierIds", Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
          >
            {logisticsSuppliers.length ? logisticsSuppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplierName(supplier)} · {supplier.supplierType || "-"}{supplier.isDefaultLogisticsSupplier ? " · 默认" : ""}
              </option>
            )) : <option value="">请先设置默认物流供应商</option>}
          </select>
          <small className={styles.mutedText}>
            {allowMultipleLogisticsSuppliers ? "可多选物流、报关、海运或港杂费用供应商。" : defaultLogisticsSupplier ? "当前使用默认物流供应商，暂不允许手动切换。" : "请先在系统设置中设置默认物流供应商。"}
          </small>
        </label>
        {form.paymentTermType === "INSTALLMENT" ? (
          <div className={`${styles.installmentPanel} ${styles.autocompleteField}`}>
            <div className={styles.panelHead}>
              <h3>分批付款节点</h3>
              <button className={styles.secondaryButton} type="button" onClick={addInstallment}>添加节点</button>
            </div>
            {form.paymentInstallments.map((row, index) => (
              <div key={`${index}-${row.condition}`} className={styles.installmentRow}>
                <label>
                  比例%
                  <input value={row.ratio} onChange={(event) => setInstallment(index, "ratio", event.target.value)} inputMode="decimal" />
                </label>
                <label>
                  付款条件
                  <input value={row.condition} onChange={(event) => setInstallment(index, "condition", event.target.value)} placeholder="例如 发货前 / 见提单" />
                </label>
                <button className={styles.secondaryButton} type="button" onClick={() => removeInstallment(index)}>删除</button>
              </div>
            ))}
            <small className={styles.mutedText}>当前合计：{installmentTotal(form.paymentInstallments)}%</small>
          </div>
        ) : null}
        <label className={styles.autocompleteField}>
          备注
          <input value={form.remark} onChange={(event) => setFormValue("remark", event.target.value)} placeholder="可选" />
        </label>
      </div>

      <div className={styles.quickCreateMeta}>
        <span>客户全称：{customer?.name || customer?.fullName || "-"}</span>
        <span>{exchangeMeta || "汇率来源：待获取"}</span>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : initialOrder?.id ? "更新订单" : "保存订单"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}
