import { useEffect, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import shell from "../../WorkspaceShell.module.css";
import type { CustomerInsight } from "./quotation-crm-insights";
import styles from "./quotation-crm-workspace.module.css";

type ContactForm = { contactPerson: string; contactPhone: string; contactEmail: string };
type CustomerContactResponse = { data?: ContactForm; customer?: ContactForm; message?: string };

function clean(value: string) {
  return value === "-" ? "" : value;
}

function contactFromCustomer(customer: CustomerInsight): ContactForm {
  return {
    contactPerson: clean(customer.contactPerson),
    contactPhone: clean(customer.contactPhone),
    contactEmail: clean(customer.contactEmail),
  };
}

export function QuotationCustomerContacts({ customer, canWriteQuotations }: { customer: CustomerInsight; canWriteQuotations: boolean }) {
  const [current, setCurrent] = useState<ContactForm>(() => contactFromCustomer(customer));
  const [form, setForm] = useState<ContactForm>(() => contactFromCustomer(customer));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    const next = contactFromCustomer(customer);
    setCurrent(next);
    setForm(next);
    setMessage("");
    setMessageIsError(false);
  }, [customer.key]);

  function setField<K extends keyof ContactForm>(key: K, value: ContactForm[K]) {
    setForm((old) => ({ ...old, [key]: value }));
  }

  async function saveContacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer.customerId) return;
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const result = await apiJson<CustomerContactResponse>(`/api/customers/${encodeURIComponent(customer.customerId)}/contact`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      const saved = result.data || result.customer || form;
      setCurrent(saved);
      setForm(saved);
      setMessage(result.message || "联系人资料已保存");
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "联系人资料保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.crmPanel}>
      <div className={styles.crmPanelHeader}>
        <div><span className={styles.crmEyebrow}>联系人维护</span><h3>客户联系人</h3></div>
        <small>{customer.customerId ? "已关联客户资料" : "历史快照"}</small>
      </div>
      <div className={styles.profileGrid}>
        <span>联系人<strong>{current.contactPerson || "-"}</strong></span>
        <span>电话<strong>{current.contactPhone || "-"}</strong></span>
        <span>邮箱<strong>{current.contactEmail || "-"}</strong></span>
      </div>
      {!customer.customerId ? <div className={styles.crmEmpty}>该客户来自历史报价快照，缺少客户 ID，暂时无法维护联系人。</div> : null}
      {customer.customerId && canWriteQuotations ? (
        <form className={styles.compactForm} onSubmit={saveContacts}>
          <label>联系人<input value={form.contactPerson} maxLength={100} onChange={(event) => setField("contactPerson", event.target.value)} /></label>
          <label>联系电话<input value={form.contactPhone} maxLength={100} onChange={(event) => setField("contactPhone", event.target.value)} /></label>
          <label>联系邮箱<input value={form.contactEmail} maxLength={200} onChange={(event) => setField("contactEmail", event.target.value)} /></label>
          <div className={styles.productFormActions}>
            <button className={shell.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : "保存联系人"}</button>
          </div>
        </form>
      ) : null}
      {message ? <div className={messageIsError ? shell.inlineError : styles.inlineSuccess} role="status">{message}</div> : null}
    </section>
  );
}
