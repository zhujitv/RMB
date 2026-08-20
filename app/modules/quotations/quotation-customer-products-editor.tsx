import { useEffect, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import type { CustomerInsight } from "./quotation-crm-insights";
import styles from "./quotation-crm-workspace.module.css";
import { customerProductDescription, type CustomerProduct, type CustomerProductsResponse } from "./types";

type ProductState = { rows: CustomerProduct[]; loading: boolean; error: string };
type ProductForm = { id: string; materialCode: string; name: string; specification: string; unit: string; remark: string };

const EMPTY_PRODUCT_FORM: ProductForm = { id: "", materialCode: "", name: "", specification: "", unit: "PCS", remark: "" };

function productFormFromRow(product: CustomerProduct): ProductForm {
  return {
    id: product.id,
    materialCode: product.materialCode || "",
    name: product.name || product.productName || "",
    specification: product.specification || "",
    unit: product.unit || "PCS",
    remark: product.remark || "",
  };
}

function priceText(product: CustomerProduct) {
  if (product.lastUnitPrice == null || product.lastUnitPrice === "") return "-";
  return formatCurrencyAmount(product.lastCurrency || "CNY", product.lastUnitPrice);
}

export function QuotationCustomerProductsEditor({ customer, canWriteQuotations }: { customer: CustomerInsight; canWriteQuotations: boolean }) {
  const [state, setState] = useState<ProductState>({ rows: [], loading: Boolean(customer.customerId), error: "" });
  const [form, setForm] = useState<ProductForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!customer.customerId) { setState({ rows: [], loading: false, error: "" }); return () => { cancelled = true; }; }
    setState({ rows: [], loading: true, error: "" });
    const params = new URLSearchParams({ customerId: customer.customerId, pageSize: "100" });
    void apiJson<CustomerProductsResponse>(`/api/customer-products?${params}`).then((result) => {
      if (cancelled) return;
      const rows = Array.isArray(result.data?.rows) ? result.data.rows : Array.isArray(result.products) ? result.products : [];
      setState({ rows, loading: false, error: "" });
    }).catch((error) => {
      if (!cancelled) setState({ rows: [], loading: false, error: error instanceof Error ? error.message : "读取客户产品库失败" });
    });
    return () => { cancelled = true; };
  }, [customer.customerId, reloadToken]);

  function setFormValue<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !customer.customerId) return;
    setSaving(true); setMessage(""); setMessageIsError(false);
    try {
      const result = await apiJson<{ message?: string }>(form.id ? `/api/customer-products/${encodeURIComponent(form.id)}` : "/api/customer-products", {
        method: form.id ? "PATCH" : "POST",
        body: JSON.stringify({ customerId: customer.customerId, materialCode: form.materialCode, name: form.name, specification: form.specification, unit: form.unit, remark: form.remark }),
      });
      setForm(null); setMessageIsError(false); setMessage(result.message || "客户产品已保存"); setReloadToken((value) => value + 1);
    } catch (error) {
      setMessageIsError(true); setMessage(error instanceof Error ? error.message : "客户产品保存失败");
    } finally { setSaving(false); }
  }

  async function voidProduct(product: CustomerProduct) {
    if (!window.confirm(`确认删除“${customerProductDescription(product)}”吗？历史报价不会改变。`)) return;
    setSaving(true); setMessage(""); setMessageIsError(false);
    try {
      const result = await apiJson<{ message?: string }>(`/api/customer-products/${encodeURIComponent(product.id)}`, { method: "DELETE" });
      setForm((current) => current?.id === product.id ? null : current);
      setMessageIsError(false); setMessage(result.message || "客户产品已删除"); setReloadToken((value) => value + 1);
    } catch (error) {
      setMessageIsError(true); setMessage(error instanceof Error ? error.message : "客户产品删除失败");
    } finally { setSaving(false); }
  }

  if (!customer.customerId) return <div className={styles.crmEmpty}>该客户来自历史报价快照，缺少客户 ID，暂时无法读取客户产品库。</div>;
  return (
    <div className={styles.productLibrary}>
      {canWriteQuotations ? <div className={styles.productToolbar}><button className={shell.primaryButtonCompact} type="button" disabled={saving} onClick={() => setForm({ ...EMPTY_PRODUCT_FORM })}>新增产品</button></div> : null}
      {form ? <ProductFormCard form={form} saving={saving} setFormValue={setFormValue} onCancel={() => setForm(null)} onSubmit={saveProduct} /> : null}
      {message ? <div className={messageIsError ? shell.inlineError : styles.inlineSuccess} role="status">{message}</div> : null}
      {state.loading ? <div className={styles.crmEmpty}>客户产品库读取中...</div> : null}
      {state.error ? <div className={shell.inlineError} role="alert">{state.error}</div> : null}
      {!state.loading && !state.error && !state.rows.length ? <div className={styles.crmEmpty}>客户产品库暂无记录，可点击“新增产品”创建。</div> : null}
      {!state.loading && !state.error && state.rows.length ? <ProductCards rows={state.rows} saving={saving} canWrite={canWriteQuotations} onEdit={(product) => setForm(productFormFromRow(product))} onVoid={(product) => void voidProduct(product)} /> : null}
    </div>
  );
}

function ProductFormCard({ form, saving, setFormValue, onCancel, onSubmit }: { form: ProductForm; saving: boolean; setFormValue: <K extends keyof ProductForm>(key: K, value: ProductForm[K]) => void; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className={styles.productForm} onSubmit={onSubmit}>
      <div className={styles.productFormHeader}><strong>{form.id ? "编辑客户产品" : "新增客户产品"}</strong></div>
      <div className={styles.productFormGrid}>
        <label>客户物料编码<input value={form.materialCode} maxLength={100} placeholder="可留空" onChange={(event) => setFormValue("materialCode", event.target.value)} /></label>
        <label>产品属性 / 品名<input value={form.name} required maxLength={200} onChange={(event) => setFormValue("name", event.target.value)} /></label>
        <label>规格补充<input value={form.specification} maxLength={500} placeholder="可留空" onChange={(event) => setFormValue("specification", event.target.value)} /></label>
        <label>单位<input value={form.unit} required maxLength={50} onChange={(event) => setFormValue("unit", event.target.value)} /></label>
        <label className={styles.productRemark}>备注<textarea value={form.remark} rows={2} maxLength={2000} onChange={(event) => setFormValue("remark", event.target.value)} /></label>
      </div>
      <div className={styles.productFormActions}><button className={shell.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存客户产品"}</button><button className={shell.secondaryButton} type="button" disabled={saving} onClick={onCancel}>取消</button></div>
    </form>
  );
}

function ProductCards({ rows, saving, canWrite, onEdit, onVoid }: { rows: CustomerProduct[]; saving: boolean; canWrite: boolean; onEdit: (product: CustomerProduct) => void; onVoid: (product: CustomerProduct) => void }) {
  return (
    <div className={styles.productCardList}>
      {rows.map((product) => (
        <article className={styles.productCard} key={product.id}>
          <div className={styles.productCardMain}>
            <span className={product.materialCode ? styles.materialCodeBadge : styles.materialCodeEmpty}>{product.materialCode || "未设置物料编码"}</span>
            <div><strong>{customerProductDescription(product)}</strong>{product.remark ? <small>{product.remark}</small> : null}</div>
          </div>
          <div className={styles.productCardFacts}>
            <span><small>单位</small><strong>{product.unit || "-"}</strong></span>
            <span><small>最近单价</small><strong>{priceText(product)}</strong></span>
            <span><small>最近报价</small><strong>{formatDate(product.lastQuotedAt || product.updatedAt)}</strong></span>
          </div>
          {canWrite ? <div className={styles.productActions}><button className={shell.rowDetailButton} type="button" disabled={saving} onClick={() => onEdit(product)}>编辑</button><button className={styles.dangerTextButton} type="button" disabled={saving} onClick={() => onVoid(product)}>删除</button></div> : null}
        </article>
      ))}
    </div>
  );
}
