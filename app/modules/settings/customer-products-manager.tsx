import { useEffect, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import { DismissibleLayer, PaginationBar } from "../../components";
import { formatDateTime } from "../../formatters";
import styles from "./settings-styles";
import managerStyles from "./customer-products-manager.module.css";
import type { CustomerRow } from "./types";

type CustomerProductRow = {
  id: string;
  materialCode?: string | null;
  name: string;
  specification?: string | null;
  unit: string;
  remark?: string | null;
  lastUnitPrice?: string | number | null;
  lastCurrency?: string | null;
  lastQuotedAt?: string | null;
};

type ProductForm = {
  id: string;
  materialCode: string;
  name: string;
  specification: string;
  unit: string;
  remark: string;
};

type ProductListResponse = {
  data?: {
    rows?: CustomerProductRow[];
    total?: number;
    page?: number;
    totalPages?: number;
  };
  message?: string;
};

const EMPTY_FORM: ProductForm = { id: "", materialCode: "", name: "", specification: "", unit: "PCS", remark: "" };

function productFormFromRow(product: CustomerProductRow): ProductForm {
  return {
    id: product.id,
    materialCode: product.materialCode || "",
    name: product.name || "",
    specification: product.specification || "",
    unit: product.unit || "PCS",
    remark: product.remark || "",
  };
}

function customerLabel(customer: CustomerRow) {
  return customer.shortName || customer.fullName || customer.name || "客户";
}

export function CustomerProductsManager({ customer, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const [rows, setRows] = useState<CustomerProductRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [form, setForm] = useState<ProductForm | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      customerId: customer.id,
      keyword: submittedKeyword,
      page: String(page),
      pageSize: "20",
    });
    setLoading(true);
    void apiJson<ProductListResponse>(`/api/customer-products?${params}`)
      .then((result) => {
        if (!active) return;
        setRows(Array.isArray(result.data?.rows) ? result.data.rows : []);
        setTotal(Number(result.data?.total || 0));
        setTotalPages(Math.max(1, Number(result.data?.totalPages || 1)));
      })
      .catch((error) => {
        if (!active) return;
        setRows([]);
        setMessageIsError(true);
        setMessage(error instanceof Error ? error.message : "产品属性读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [customer.id, page, reloadToken, submittedKeyword]);

  function setFormValue<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const result = await apiJson<{ message?: string }>(
        form.id ? `/api/customer-products/${form.id}` : "/api/customer-products",
        {
          method: form.id ? "PATCH" : "POST",
          body: JSON.stringify({
            customerId: customer.id,
            materialCode: form.materialCode,
            name: form.name,
            specification: form.specification,
            unit: form.unit,
            remark: form.remark,
          }),
        },
      );
      setForm(null);
      setMessageIsError(false);
      setMessage(result.message || "产品属性已保存");
      setReloadToken((value) => value + 1);
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "产品属性保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function voidProduct(product: CustomerProductRow) {
    if (!window.confirm(`确认删除“${product.name}”？历史报价和销售数据不会改变。`)) return;
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const result = await apiJson<{ message?: string }>(`/api/customer-products/${product.id}`, { method: "DELETE" });
      setForm((current) => current?.id === product.id ? null : current);
      setMessageIsError(false);
      setMessage(result.message || "产品属性已删除");
      setReloadToken((value) => value + 1);
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "产品属性删除失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DismissibleLayer
      ariaLabel={`${customerLabel(customer)}客户产品库`}
      overlayClassName={styles.modalOverlay}
      surfaceClassName={`${styles.supplierSettingsModalCard} ${managerStyles.surface}`}
      onClose={onClose}
      dismissible={!saving}
      dismissConfirmMessage={form ? "产品属性表单尚未保存，确认关闭吗？" : ""}
    >
      {({ requestClose }) => (
        <>
          <div className={styles.supplierSettingsModalHeader}>
            <div>
              <strong>产品属性 · {customerLabel(customer)}</strong>
            </div>
            <button className={styles.supplierSettingsModalClose} type="button" onClick={requestClose} disabled={saving} aria-label="关闭客户产品库">×</button>
          </div>
          <div className={managerStyles.body}>
            <form
              className={managerStyles.toolbar}
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setMessage("");
                setMessageIsError(false);
                setSubmittedKeyword(keyword.trim());
              }}
            >
              <label className={managerStyles.searchField}>
                搜索产品属性
                <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="物料编码、产品描述、规格或单位" />
              </label>
              <div className={managerStyles.toolbarActions}>
                <button className={styles.secondaryButton} type="submit" disabled={loading}>查询</button>
                <button className={styles.primaryButtonCompact} type="button" onClick={() => setForm({ ...EMPTY_FORM })}>新增产品</button>
              </div>
            </form>

            {form ? (
              <form className={managerStyles.formCard} onSubmit={saveProduct}>
                <div className={managerStyles.formHeader}>
                  <strong>{form.id ? "编辑产品属性" : "新增产品属性"}</strong>
                </div>
                <div className={managerStyles.formGrid}>
                  <label>
                    客户物料编码
                    <input value={form.materialCode} onChange={(event) => setFormValue("materialCode", event.target.value)} maxLength={100} placeholder="可留空" />
                  </label>
                  <label>
                    产品属性
                    <input value={form.name} onChange={(event) => setFormValue("name", event.target.value)} required maxLength={200} />
                  </label>
                  <label>
                    规格补充
                    <input value={form.specification} onChange={(event) => setFormValue("specification", event.target.value)} maxLength={500} placeholder="可留空" />
                  </label>
                  <label>
                    单位
                    <input value={form.unit} onChange={(event) => setFormValue("unit", event.target.value)} required maxLength={50} />
                  </label>
                  <label className={managerStyles.remarkField}>
                    备注
                    <textarea value={form.remark} onChange={(event) => setFormValue("remark", event.target.value)} rows={2} maxLength={2000} />
                  </label>
                </div>
                <div className={managerStyles.formActions}>
                  <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存产品属性"}</button>
                  <button className={styles.secondaryButton} type="button" onClick={() => setForm(null)} disabled={saving}>取消</button>
                </div>
              </form>
            ) : null}

            {message ? <div className={messageIsError ? styles.inlineError : styles.inlineSuccess}>{message}</div> : null}
            <div className={styles.tableWrap}>
              <table className={styles.dataTable}>
                <thead><tr><th>物料编码</th><th>产品属性</th><th>单位</th><th>最近价格</th><th>最近使用</th><th>操作</th></tr></thead>
                <tbody>
                  {loading ? <tr><td colSpan={6}><div className={styles.emptyState}>产品属性加载中...</div></td></tr> : null}
                  {!loading && !rows.length ? <tr><td colSpan={6}><div className={styles.emptyState}>暂无产品属性，可点击“新增产品”创建。</div></td></tr> : null}
                  {!loading ? rows.map((product) => (
                    <tr key={product.id}>
                      <td>{product.materialCode || "-"}</td>
                      <td className={managerStyles.descriptionCell}>
                        <strong>{product.name || "-"}</strong>
                        {product.specification ? <span>{product.specification}</span> : null}
                      </td>
                      <td>{product.unit || "-"}</td>
                      <td>{product.lastUnitPrice == null ? "-" : `${product.lastCurrency || ""} ${product.lastUnitPrice}`.trim()}</td>
                      <td>{product.lastQuotedAt ? formatDateTime(product.lastQuotedAt) : "-"}</td>
                      <td><div className={styles.rowActionGroup}>
                        <button className={styles.rowDetailButton} type="button" onClick={() => setForm(productFormFromRow(product))}>编辑</button>
                        <button className={styles.dangerButton} type="button" onClick={() => void voidProduct(product)} disabled={saving}>作废</button>
                      </div></td>
                    </tr>
                  )) : null}
                </tbody>
              </table>
            </div>
            <PaginationBar total={total} page={page} totalPages={totalPages} onPage={setPage} />
            <span className={managerStyles.hint}>作废后的产品不再出现在新报价和销售建议中，历史单据仍保留原内容。</span>
          </div>
        </>
      )}
    </DismissibleLayer>
  );
}
