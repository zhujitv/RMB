"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { CustomerAutocomplete, type CustomerAutocompleteOption } from "../../CustomerAutocomplete";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import {
  allocationPayload,
  allocationPayloadByLine,
  applyDefaultSupplier,
  comparableDraft,
  comparableSalesData,
  directExecutionPayload,
  draftFromExecution,
  executionCustomerOption,
  itemWeightsPayload,
  singleSupplierIdFromItems,
  validateSalesExecutionDraft,
} from "./draft-utils";
import { SalesLinesEditor } from "./sales-lines-editor";
import styles from "./sales-execution.module.css";
import {
  businessEntityName,
  draftKey,
  filterSupplierOptions,
  SALES_CURRENCIES,
  SALES_TRADE_TERMS,
  supplierName,
  type BusinessEntityOption,
  type CustomerProduct,
  type SalesExecutionDraft,
  type SalesExecutionResponse,
  type SalesExecutionRow,
  type SupplierOption,
} from "./types";

type CustomerProductsResponse = { data?: { rows?: CustomerProduct[] }; products?: CustomerProduct[] };

export function ExecutionFormPanel({
  initialExecution,
  businessEntities,
  suppliers,
  onCancel,
  onSaved,
}: {
  initialExecution?: SalesExecutionRow | null;
  businessEntities: BusinessEntityOption[];
  suppliers: SupplierOption[];
  onCancel: () => void;
  onSaved: (execution: SalesExecutionRow, message: string) => void;
}) {
  const [form, setForm] = useState<SalesExecutionDraft>(() => draftFromExecution(initialExecution));
  const [customer, setCustomer] = useState<CustomerAutocompleteOption | null>(() => executionCustomerOption(initialExecution));
  const [products, setProducts] = useState<CustomerProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsMessage, setProductsMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [persistedExecution, setPersistedExecution] = useState<SalesExecutionRow | null>(null);
  const [defaultSupplierId, setDefaultSupplierId] = useState(() => singleSupplierIdFromItems(draftFromExecution(initialExecution).items));
  const [creationKey] = useState(() => draftKey("sales-execution-create"));
  const productsRequestRef = useRef(0);
  const savingRef = useRef(false);
  const quotationSource = initialExecution?.sourceType === "QUOTATION";
  const existing = Boolean(initialExecution?.id);
  const baseline = useMemo(() => comparableDraft(draftFromExecution(initialExecution)), [initialExecution?.id, initialExecution?.updatedAt, initialExecution?.revision]);
  const dirty = JSON.stringify(comparableDraft(form)) !== JSON.stringify(baseline);
  useWorkspaceTabDirty(dirty);
  useWorkspaceTabBusy(saving);

  useEffect(() => {
    setForm(draftFromExecution(initialExecution));
    setCustomer(executionCustomerOption(initialExecution));
    setPersistedExecution(null);
    setDefaultSupplierId(singleSupplierIdFromItems(draftFromExecution(initialExecution).items));
    setMessage("");
  }, [initialExecution?.id, initialExecution?.updatedAt, initialExecution?.revision]);

  useEffect(() => {
    const requestId = ++productsRequestRef.current;
    if (!form.customerId || quotationSource) {
      setProducts([]);
      setProductsLoading(false);
      setProductsMessage("");
      return;
    }
    setProductsLoading(true);
    const params = new URLSearchParams({ customerId: form.customerId, currency: form.currency, page: "1", pageSize: "100" });
    void apiJson<CustomerProductsResponse>(`/api/customer-products?${params}`).then((result) => {
      if (requestId !== productsRequestRef.current) return;
      const rows = Array.isArray(result.data?.rows) ? result.data.rows : Array.isArray(result.products) ? result.products : [];
      setProducts(rows);
      setProductsMessage(rows.length ? "" : "该客户暂无历史产品，本次录入后会自动保留。 ");
    }).catch((error) => {
      if (requestId !== productsRequestRef.current) return;
      setProducts([]);
      setProductsMessage(error instanceof Error ? `客户产品读取失败：${error.message}` : "客户产品读取失败，可继续手工填写。 ");
    }).finally(() => {
      if (requestId === productsRequestRef.current) setProductsLoading(false);
    });
  }, [form.customerId, form.currency, quotationSource]);

  function setFormValue<K extends keyof SalesExecutionDraft>(key: K, value: SalesExecutionDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectCustomer(nextCustomer: CustomerAutocompleteOption) {
    setCustomer(nextCustomer);
    setMessage("");
    setForm((current) => ({
      ...current,
      customerId: nextCustomer.id,
      currency: String(nextCustomer.defaultCurrency || current.currency || "USD").toUpperCase(),
      tradeTerm: nextCustomer.defaultTradeTerm || current.tradeTerm,
      paymentTerm: nextCustomer.defaultPaymentTermType || current.paymentTerm,
      items: current.items.map((item) => ({ ...item, customerProductId: "", salesUnitPrice: "", salesPriceSource: "" })),
    }));
  }

  function selectDefaultSupplier(supplier: SupplierOption) {
    setDefaultSupplierId(supplier.id);
    setForm((current) => ({ ...current, items: applyDefaultSupplier(current.items, supplier.id) }));
  }

  function salesDataChanged(savedBefore: SalesExecutionRow | null | undefined) {
    return !savedBefore?.id
      || JSON.stringify(comparableSalesData(form)) !== JSON.stringify(comparableSalesData(draftFromExecution(savedBefore)));
  }

  async function saveHeader(savedBefore: SalesExecutionRow | null | undefined, changed: boolean) {
    if (savedBefore?.id && !changed) {
      return { success: true, data: savedBefore, execution: savedBefore } satisfies SalesExecutionResponse;
    }
    if (!savedBefore?.id) {
      return apiJson<SalesExecutionResponse>("/api/sales-executions", {
        method: "POST",
        body: JSON.stringify({
          ...directExecutionPayload(form),
          creationKey,
          allocations: allocationPayloadByLine(form),
        }),
      });
    }
    const shared = {
      expectedRevision: Number(savedBefore.revision || 1),
      customerOrderNo: form.customerOrderNo.trim(),
      requestedDeliveryDate: form.requestedDeliveryDate,
      remark: form.remark.trim(),
    };
    return apiJson<SalesExecutionResponse>(`/api/sales-executions/${encodeURIComponent(savedBefore.id)}`, {
      method: "PATCH",
      body: JSON.stringify(quotationSource
        ? { ...shared, itemWeights: itemWeightsPayload(form), allocations: allocationPayload(savedBefore, form).allocations }
        : {
            ...directExecutionPayload(form),
            ...shared,
            sourceType: undefined,
            allocations: allocationPayloadByLine(form),
          }),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    const validationMessage = validateSalesExecutionDraft(form);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      const savedBefore = persistedExecution || initialExecution;
      const changed = salesDataChanged(savedBefore);
      const headerResult = await saveHeader(savedBefore, changed);
      const headerSaved = headerResult.execution || headerResult.data;
      if (headerResult.success !== true || !headerSaved) throw new Error(headerResult.message || "销售执行草稿保存失败");
      setPersistedExecution(headerSaved);
      if (changed) {
        onSaved(headerSaved, headerResult.message || "销售执行草稿已更新并生成新版本");
        return;
      }
      const allocationResult = await apiJson<SalesExecutionResponse>(`/api/sales-executions/${encodeURIComponent(headerSaved.id)}/purchase-orders`, {
        method: "PUT",
        body: JSON.stringify(allocationPayload(headerSaved, form)),
      });
      const saved = allocationResult.execution || allocationResult.data;
      if (allocationResult.success !== true || !saved) throw new Error(allocationResult.message || "工厂采购分配保存失败");
      onSaved(saved, allocationResult.message || (existing ? "销售执行草稿已更新并生成新版本" : "销售执行草稿已创建"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "销售执行草稿保存失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <form className={styles.formPanel} onSubmit={submit} inert={saving} aria-busy={saving}>
      <div className={styles.formHeader}>
        <div className={styles.formTitle}>
          <strong>{existing ? `编辑销售执行草稿 · ${initialExecution?.executionNo || "未编号"}` : "直接创建销售执行草稿"}</strong>
          <small>{quotationSource ? "客户销售数据来自已接受报价，仅补充执行信息和工厂分配。" : existing ? `保存后生成版本 V${Number(initialExecution?.currentVersionNumber || 1) + 1}` : "客户和业务主体都必须手动选择，保存后系统自动编号。"}</small>
        </div>
        <span className={`${styles.sourcePill} ${quotationSource ? styles.sourceQuote : ""}`}>{quotationSource ? "报价转入" : "直接创建"}</span>
      </div>
      {message ? <div className={shell.inlineError} role="alert">{message}</div> : null}

      <div className={styles.formGrid}>
        <label className={styles.wideField}>
          客户
          {existing ? <span className={styles.readonlyValue}>{customer?.displayName || customer?.shortName || customer?.name || initialExecution?.customerNameSnapshot || "-"}</span> : (
            <CustomerAutocomplete value={customer} disabled={saving} onSelect={selectCustomer} onCreateRequested={(keyword) => setMessage(`请先到系统设置 > 客户资料中新建客户：${keyword}`)} />
          )}
        </label>
        <label>
          业务主体
          {quotationSource ? <span className={styles.readonlyValue}>{businessEntityName(initialExecution?.businessEntity) !== "-" ? businessEntityName(initialExecution?.businessEntity) : initialExecution?.businessEntityNameSnapshot || "-"}</span> : (
            <select required value={form.businessEntityId} disabled={saving} onChange={(event) => setFormValue("businessEntityId", event.target.value)}>
              <option value="">请选择业务主体</option>
              {businessEntities.map((entity) => <option key={entity.id} value={entity.id}>{businessEntityName(entity)}</option>)}
            </select>
          )}
        </label>
        <label>销售币种<select value={form.currency} disabled={saving || quotationSource} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value, items: current.items.map((item) => ({ ...item, salesUnitPrice: "", salesPriceSource: "" })) }))}>{SALES_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
        <label>贸易条款<select value={form.tradeTerm} disabled={saving || quotationSource} onChange={(event) => setFormValue("tradeTerm", event.target.value)}><option value="">未指定</option>{SALES_TRADE_TERMS.map((term) => <option key={term} value={term}>{term}</option>)}</select></label>
        <label className={styles.wideField}>付款条款<input value={form.paymentTerm} disabled={saving || quotationSource} onChange={(event) => setFormValue("paymentTerm", event.target.value)} /></label>
        <label>
          客户订单号
          <input required maxLength={100} value={form.customerOrderNo} disabled={saving} onChange={(event) => setFormValue("customerOrderNo", event.target.value)} />
          <span className={styles.fieldHint}>必填，将作为后续下单、采购和交付流程的重要凭证。</span>
        </label>
        <label>
          客户要求交货日期
          <input type="date" required value={form.requestedDeliveryDate} disabled={saving} onChange={(event) => setFormValue("requestedDeliveryDate", event.target.value)} />
          <span className={styles.fieldHint}>保留客户的原始要求；供应商后续反馈新日期时不会覆盖此日期。</span>
        </label>
        <label className={styles.fullField}>
          整单默认工厂（可选）
          <SearchAutocomplete
            value={suppliers.find((supplier) => supplier.id === defaultSupplierId) || null}
            disabled={saving}
            cacheKey={`sales-execution-default-factory:${suppliers.map((supplier) => `${supplier.id}:${supplierName(supplier)}:${supplier.supplierType || ""}`).join("|")}`}
            emptyLabel="未找到匹配工厂，请先到系统设置维护产品供应商"
            placeholder="输入工厂名称模糊查找"
            getLabel={supplierName}
            getDescription={(supplier) => supplier.supplierType || "产品供应商"}
            search={(keyword) => Promise.resolve(filterSupplierOptions(suppliers, keyword))}
            onSelect={selectDefaultSupplier}
            onSelectedValueInvalidated={() => setDefaultSupplierId("")}
          />
          <span className={styles.fieldHint}>选择一次后，仅自动填充还没有工厂的单一分配行；已分厂或已选工厂的产品不会被覆盖。</span>
        </label>
        <label className={styles.fullField}>内部备注<textarea value={form.remark} disabled={saving} onChange={(event) => setFormValue("remark", event.target.value)} /></label>
      </div>

      <SalesLinesEditor currency={form.currency} sourceType={initialExecution?.sourceType || "DIRECT"} items={form.items} products={products} productsLoading={productsLoading} productsMessage={productsMessage} suppliers={suppliers} defaultSupplierId={defaultSupplierId} disabled={saving} onChange={(items) => setFormValue("items", items)} />
      <div className={styles.formActions}>
        <button className={shell.secondaryButton} type="button" disabled={saving} onClick={onCancel}>取消</button>
        <button className={shell.primaryButtonCompact} type="submit" disabled={saving || !dirty}>{saving ? "保存中..." : existing ? "保存新版本" : "保存销售执行草稿"}</button>
      </div>
    </form>
  );
}
