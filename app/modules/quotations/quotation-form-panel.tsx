"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { CustomerAutocomplete, type CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import { QuotationBusinessEntitySelect, QuotationCustomerContactSummary } from "./quotation-business-entity-select";
import { QuotationItemsEditor } from "./quotation-items-editor";
import styles from "./quotation-form.module.css";
import {
  comparableQuotationDraft,
  currentQuotationVersion,
  quotationItemDescription,
  quotationNeedsSellerSnapshotRepair,
  quotationCustomerOption,
  quotationDraftFromRow,
  quotationNumber,
  QUOTATION_CURRENCIES,
  QUOTATION_TRADE_TERMS,
  type CustomerProduct,
  type CustomerProductsResponse,
  type QuotationDetailResponse,
  type QuotationDraft,
  type QuotationBusinessEntity,
  type QuotationRow,
} from "./types";
export function QuotationFormPanel({
  initialQuotation,
  businessEntities = [],
  onCancel,
  onSaved,
}: {
  initialQuotation?: QuotationRow | null;
  businessEntities?: QuotationBusinessEntity[];
  onCancel: () => void;
  onSaved: (quotation: QuotationRow, message: string) => void;
}) {
  const businessEntityLocked = Boolean(initialQuotation?.id && initialQuotation.businessEntityId);
  const [form, setForm] = useState<QuotationDraft>(() => quotationDraftFromRow(initialQuotation));
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerAutocompleteOption | null>(() => quotationCustomerOption(initialQuotation));
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsMessage, setProductsMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const productsRequestRef = useRef(0);
  const savingRef = useRef(false);
  const baseline = useMemo(
    () => comparableQuotationDraft(quotationDraftFromRow(initialQuotation)),
    [initialQuotation?.id, initialQuotation?.updatedAt],
  );
  const dirty = JSON.stringify(comparableQuotationDraft(form)) !== JSON.stringify(baseline);
  const sellerSnapshotRepairRequired = quotationNeedsSellerSnapshotRepair(initialQuotation);
  useWorkspaceTabDirty(dirty);
  useWorkspaceTabBusy(saving);
  useEffect(() => {
    setForm(quotationDraftFromRow(initialQuotation));
    setSelectedCustomer(quotationCustomerOption(initialQuotation));
    setMessage("");
  }, [initialQuotation?.id, initialQuotation?.updatedAt]);

  useEffect(() => {
    const customerId = form.customerId;
    const requestId = ++productsRequestRef.current;
    if (!customerId) {
      setProducts([]);
      setProductsLoading(false);
      setProductsMessage("");
      return;
    }
    setProductsLoading(true);
    setProductsMessage("");
    const params = new URLSearchParams({
      customerId,
      currency: form.currency.trim().toUpperCase(),
      page: "1",
      pageSize: "100",
    });
    void apiJson<CustomerProductsResponse>(`/api/customer-products?${params}`)
      .then((result) => {
        if (requestId !== productsRequestRef.current) return;
        const rows = Array.isArray(result.data?.rows)
          ? result.data.rows
          : Array.isArray(result.products) ? result.products : [];
        setProducts(rows);
        setProductsMessage(rows.length ? "" : "该客户暂无历史产品，本次填写后会自动保留。");
      })
      .catch((error) => {
        if (requestId !== productsRequestRef.current) return;
        setProducts([]);
        setProductsMessage(error instanceof Error ? `客户产品读取失败：${error.message}` : "客户产品读取失败，可继续手工填写。");
      })
      .finally(() => {
        if (requestId === productsRequestRef.current) setProductsLoading(false);
      });
  }, [form.customerId, form.currency]);

  function setFormValue<K extends keyof QuotationDraft>(key: K, value: QuotationDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectCustomer(customer: CustomerAutocompleteOption) {
    setSelectedCustomer(customer);
    setMessage("");
    setForm((current) => ({
      ...current,
      customerId: customer.id,
      currency: String(customer.defaultCurrency || current.currency || "USD").toUpperCase(),
      tradeTerm: customer.defaultTradeTerm || current.tradeTerm,
      paymentTerm: customer.defaultPaymentTermType || current.paymentTerm,
      items: current.items.map((item) => ({
        ...item,
        customerProductId: "",
        description: quotationItemDescription(item),
        specification: "",
        unitPrice: "",
        unitPriceSource: "",
      })),
    }));
  }

  function selectCurrency(currency: string) {
    setForm((current) => ({
      ...current,
      currency,
      items: current.items.map((item) => ({ ...item, unitPrice: "", unitPriceSource: "" })),
    }));
  }

  function validate() {
    if (!form.customerId) return "请选择已有客户";
    if (!form.businessEntityId) return "请选择业务主体";
    if (!form.currency.trim()) return "请选择币种";
    if (!form.validUntil) return "请选择报价有效期";
    if (form.leadTimeDays && Number(form.leadTimeDays) < 0) return "预计交期不能小于 0 天";
    if (!form.items.length) return "请至少添加一条报价明细";
    for (let index = 0; index < form.items.length; index += 1) {
      const item = form.items[index];
      if (!item.description.trim()) return `第 ${index + 1} 行请填写产品描述（含规格）`;
      if (!item.unit.trim()) return `第 ${index + 1} 行请填写单位`;
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) return `第 ${index + 1} 行数量必须大于 0`;
      if (!item.unitPrice.trim() || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) return `第 ${index + 1} 行请填写有效单价`;
    }
    return "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const validationMessage = validate();
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      const isEdit = Boolean(initialQuotation?.id);
      const payload = {
        customerId: form.customerId,
        businessEntityId: form.businessEntityId,
        validUntil: form.validUntil || undefined,
        currency: form.currency.trim().toUpperCase(),
        tradeTerm: form.tradeTerm.trim(),
        paymentTerm: form.paymentTerm.trim(),
        leadTimeDays: form.leadTimeDays === "" ? null : Number(form.leadTimeDays),
        remark: form.remark.trim(),
        items: form.items.map((item) => ({
          customerProductId: item.customerProductId || undefined,
          name: item.description.trim(),
          specification: item.specification.trim(),
          unit: item.unit.trim(),
          quantity: item.quantity.trim(),
          unitPrice: item.unitPrice.trim(),
          remark: item.remark.trim(),
        })),
        ...(isEdit ? {
          expectedVersionNumber: Number(initialQuotation?.currentVersionNumber || version?.versionNumber || 1),
        } : {}),
      };
      const result = await apiJson<QuotationDetailResponse>(
        isEdit ? `/api/quotations/${encodeURIComponent(initialQuotation?.id || "")}` : "/api/quotations",
        { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      const saved = result.quotation || result.data;
      if (result.success !== true || !saved) throw new Error(result.message || "报价保存失败");
      onSaved(saved, result.message || (isEdit ? "报价草稿已更新并生成新版本" : "报价草稿已创建"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "报价保存失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const version = currentQuotationVersion(initialQuotation);

  return (
    <form className={styles.formPanel} onSubmit={submit} inert={saving} aria-busy={saving}>
      <div className={styles.formHeader}>
        <div className={styles.formTitle}>
          <strong>{initialQuotation?.id ? "编辑报价草稿" : "新建报价草稿"}</strong>
          <small>{initialQuotation?.id ? `保存后将生成版本 V${Number(initialQuotation.currentVersionNumber || version?.versionNumber || 1) + 1}` : "报价号将在首次保存时由系统自动生成"}</small>
        </div>
      </div>

      {message ? <div className={shell.inlineError}>{message}</div> : null}
      {sellerSnapshotRepairRequired ? <div className={shell.infoStrip}>当前报价使用旧版卖方资料或 PI 模板，可直接保存生成新版；原版本不会被修改。</div> : null}

      <div className={styles.formGrid}>
        <label className={styles.wideField}>
          客户
          <CustomerAutocomplete
            value={selectedCustomer}
            disabled={saving || Boolean(initialQuotation?.id)}
            onSelect={selectCustomer}
            onCreateRequested={(keyword) => setMessage(`请先到系统设置 > 客户资料中新建客户：${keyword}`)}
          />
          {initialQuotation?.id ? <small>已创建报价的客户不可更换。</small> : null}
        </label>
        <label>
          报价号
          <span className={styles.readonlyValue}>{quotationNumber(initialQuotation) || "保存后自动生成"}</span>
        </label>
        <QuotationBusinessEntitySelect
          value={form.businessEntityId}
          entities={businessEntities}
          currentEntity={initialQuotation?.businessEntity}
          disabled={saving}
          locked={businessEntityLocked}
          onChange={(value) => setFormValue("businessEntityId", value)}
        />
        <QuotationCustomerContactSummary customer={selectedCustomer} />
        <label>
          币种
          <select value={form.currency} disabled={saving} onChange={(event) => selectCurrency(event.target.value)}>
            {QUOTATION_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        <label>
          贸易条款
          <select value={form.tradeTerm} disabled={saving} onChange={(event) => setFormValue("tradeTerm", event.target.value)}>
            <option value="">未指定</option>
            {QUOTATION_TRADE_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
          </select>
        </label>
        <label className={styles.wideField}>
          付款条款
          <input value={form.paymentTerm} disabled={saving} placeholder="例如 30% 预付，余款发货前付清" onChange={(event) => setFormValue("paymentTerm", event.target.value)} />
        </label>
        <label>
          有效期至
          <input type="date" value={form.validUntil} disabled={saving} onChange={(event) => setFormValue("validUntil", event.target.value)} />
        </label>
        <label>
          预计交期（天）
          <input type="number" min="0" step="1" value={form.leadTimeDays} disabled={saving} placeholder="例如 30" onChange={(event) => setFormValue("leadTimeDays", event.target.value)} />
        </label>
        <label className={styles.fullField}>
          备注
          <textarea value={form.remark} disabled={saving} placeholder="包装、装运、报价范围等补充说明" onChange={(event) => setFormValue("remark", event.target.value)} />
        </label>
      </div>

      <QuotationItemsEditor
        currency={form.currency}
        items={form.items}
        products={products}
        productsLoading={productsLoading}
        productsMessage={productsMessage}
        disabled={saving}
        onChange={(items) => setFormValue("items", items)}
      />

      <div className={styles.formActions}>
        <button className={shell.secondaryButton} type="button" disabled={saving} onClick={onCancel}>取消</button>
        <button
          className={shell.primaryButtonCompact}
          type="submit"
          disabled={saving || (!dirty && !sellerSnapshotRepairRequired)}
          title={!dirty && !sellerSnapshotRepairRequired ? "请先填写或修改报价内容" : undefined}
        >
          {saving ? "保存中..." : sellerSnapshotRepairRequired ? "更新卖方资料并生成新版本" : initialQuotation?.id ? "保存新版本" : "保存草稿"}
        </button>
      </div>
    </form>
  );
}
