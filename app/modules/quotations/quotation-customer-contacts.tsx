import { useEffect, useState, type FormEvent } from "react";
import { apiJson } from "../../api";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import type { CustomerInsight } from "./quotation-crm-insights";
import contactStyles from "./quotation-customer-contacts.module.css";
import styles from "./quotation-crm-workspace.module.css";

export type CustomerContactFields = { contactPerson: string; contactPhone: string; contactEmail: string };
type CustomerContactResponse = { data?: Partial<CustomerContactFields>; customer?: Partial<CustomerContactFields>; message?: string };

const CONTACT_FIELDS: Array<{ key: keyof CustomerContactFields; label: string }> = [
  { key: "contactPerson", label: "姓名" },
  { key: "contactPhone", label: "电话" },
  { key: "contactEmail", label: "邮箱" },
];

function clean(value?: string | null) {
  return value === "-" ? "" : String(value || "").trim();
}

function contactFromCustomer(customer: CustomerInsight | Partial<CustomerContactFields>): CustomerContactFields {
  return {
    contactPerson: clean(customer.contactPerson),
    contactPhone: clean(customer.contactPhone),
    contactEmail: clean(customer.contactEmail),
  };
}

function sameContact(left: CustomerContactFields, right: CustomerContactFields) {
  return CONTACT_FIELDS.every(({ key }) => clean(left[key]) === clean(right[key]));
}

function ContactActions({ contact }: { contact: CustomerContactFields }) {
  return (
    <div className={contactStyles.quickActions} aria-label="联系人快捷操作">
      {contact.contactPhone ? <a href={`tel:${contact.contactPhone.replace(/[^+\d]/g, "")}`}>拨打电话</a> : null}
      {contact.contactEmail ? <a href={`mailto:${contact.contactEmail}`}>发送邮件</a> : null}
    </div>
  );
}

export function QuotationCustomerContacts({
  customer,
  canWriteQuotations,
  onSaved,
}: {
  customer: CustomerInsight;
  canWriteQuotations: boolean;
  onSaved?: (contact: CustomerContactFields) => void;
}) {
  const [saved, setSaved] = useState<CustomerContactFields>(() => contactFromCustomer(customer));
  const [form, setForm] = useState<CustomerContactFields>(() => contactFromCustomer(customer));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    const next = contactFromCustomer(customer);
    setSaved(next);
    setForm(next);
  }, [customer.key, customer.contactPerson, customer.contactPhone, customer.contactEmail]);

  const completion = CONTACT_FIELDS.filter(({ key }) => clean(form[key])).length;
  const dirty = !sameContact(saved, form);
  useWorkspaceTabDirty(dirty);
  useWorkspaceTabBusy(saving);

  function setField<K extends keyof CustomerContactFields>(key: K, value: CustomerContactFields[K]) {
    setForm((old) => ({ ...old, [key]: value }));
    setMessage("");
  }

  function resetForm() {
    setForm(saved);
    setMessage("已撤销未保存的修改");
    setMessageIsError(false);
  }

  async function saveContacts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer.customerId || !dirty) return;
    setSaving(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const payload = contactFromCustomer(form);
      const result = await apiJson<CustomerContactResponse>(`/api/customers/${encodeURIComponent(customer.customerId)}/contact`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const savedContact = contactFromCustomer(result.data || result.customer || payload);
      setSaved(savedContact);
      setForm(savedContact);
      onSaved?.(savedContact);
      setMessage(result.message || "联系人资料已保存并同步到客户档案");
    } catch (error) {
      setMessageIsError(true);
      setMessage(error instanceof Error ? error.message : "联系人资料保存失败");
    } finally {
      setSaving(false);
    }
  }

  const editable = Boolean(customer.customerId && canWriteQuotations);
  return (
    <section className={styles.crmPanel}>
      <div className={styles.crmPanelHeader}>
        <div><span className={styles.crmEyebrow}>联系人维护</span><h3>主要联系人</h3></div>
        <small>{customer.customerId ? (editable ? "客户主档案 · 可编辑" : "客户主档案 · 只读") : "历史报价快照"}</small>
      </div>

      <div className={contactStyles.overview}>
        <div>
          <strong>资料完整度 {completion}/3</strong>
          <span>{completion === 3 ? "姓名与联系方式已完整" : "建议补齐姓名、电话和邮箱，便于报价跟进"}</span>
        </div>
        <div className={contactStyles.statusChips}>
          {CONTACT_FIELDS.map(({ key, label }) => <span className={clean(form[key]) ? contactStyles.complete : ""} key={key}>{label}{clean(form[key]) ? "已维护" : "待补充"}</span>)}
        </div>
      </div>

      {editable ? (
        <form className={contactStyles.form} onSubmit={saveContacts}>
          <label>联系人姓名<input autoComplete="name" value={form.contactPerson} maxLength={100} disabled={saving} placeholder="例如：王经理" onChange={(event) => setField("contactPerson", event.target.value)} /></label>
          <label>联系电话<input type="tel" autoComplete="tel" value={form.contactPhone} maxLength={100} disabled={saving} placeholder="手机号、座机或国际号码" onChange={(event) => setField("contactPhone", event.target.value)} /></label>
          <label>联系邮箱<input type="email" autoComplete="email" value={form.contactEmail} maxLength={200} disabled={saving} placeholder="name@example.com" onChange={(event) => setField("contactEmail", event.target.value)} /></label>
          <div className={contactStyles.formFooter}>
            <span>{dirty ? "有未保存修改" : "当前资料已同步"}</span>
            <div className={styles.productFormActions}>
              <button className={shell.secondaryButton} type="button" disabled={!dirty || saving} onClick={resetForm}>撤销修改</button>
              <button className={shell.primaryButtonCompact} type="submit" disabled={!dirty || saving}>{saving ? "保存中..." : "保存联系人"}</button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <div className={styles.profileGrid}>
            <span>联系人<strong>{saved.contactPerson || "-"}</strong></span>
            <span>电话<strong>{saved.contactPhone || "-"}</strong></span>
            <span>邮箱<strong>{saved.contactEmail || "-"}</strong></span>
          </div>
          {!customer.customerId ? <div className={styles.crmEmpty}>该客户来自历史报价快照，缺少客户 ID，暂时无法维护联系人。</div> : null}
        </>
      )}
      <ContactActions contact={saved} />
      {message ? <div className={messageIsError ? shell.inlineError : styles.inlineSuccess} role="status">{message}</div> : null}
    </section>
  );
}
