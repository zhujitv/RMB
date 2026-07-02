"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiRequestError, apiJson } from "../api";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";

type CompanyHsItem = {
  id: string;
  hsCode: string;
  cnName: string;
  enName?: string;
  unit: string;
  rebateRate: number;
  vatRate: number;
  keywords?: string;
  remark?: string;
  isEnabled?: boolean;
  updatedAt?: string;
};

type CompanyHsForm = {
  id?: string;
  hsCode: string;
  cnName: string;
  enName: string;
  unit: string;
  rebateRate: string;
  vatRate: string;
  keywords: string;
  remark: string;
  isEnabled: boolean;
};

const emptyForm: CompanyHsForm = {
  hsCode: "",
  cnName: "",
  enName: "",
  unit: "",
  rebateRate: "13",
  vatRate: "13",
  keywords: "",
  remark: "",
  isEnabled: true,
};

function itemToForm(item: CompanyHsItem): CompanyHsForm {
  return {
    id: item.id,
    hsCode: item.hsCode || "",
    cnName: item.cnName || "",
    enName: item.enName || "",
    unit: item.unit || "",
    rebateRate: String(item.rebateRate ?? ""),
    vatRate: String(item.vatRate ?? ""),
    keywords: item.keywords || "",
    remark: item.remark || "",
    isEnabled: item.isEnabled !== false,
  };
}

function percentText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function CompanyHsModule({
  currentUser,
  permissions,
  features,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  features?: { enabled?: boolean; companyHsLibraryEnabled?: boolean };
}) {
  const featureEnabled = !features || (features.enabled !== false && features.companyHsLibraryEnabled !== false);
  const canManage = canWritePermission(currentUser, permissions, "companyHs");
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<CompanyHsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<CompanyHsForm | null>(canManage && featureEnabled ? emptyForm : null);

  const activeCount = useMemo(() => items.filter((item) => item.isEnabled !== false).length, [items]);

  async function loadItems(nextKeyword = keyword) {
    setLoading(true);
    setError("");
    if (!featureEnabled) {
      setItems([]);
      setLoading(false);
      setError("企业HS编码库功能已关闭。");
      return;
    }
    try {
      const query = new URLSearchParams();
      if (nextKeyword.trim()) query.set("keyword", nextKeyword.trim());
      const result = await apiJson<{ success?: boolean; items?: CompanyHsItem[] }>(`/api/company-hs?${query.toString()}`, { timeoutMs: 10000 });
      setItems(result.items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取企业HS编码失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems("");
  }, []);

  function updateForm(patch: Partial<CompanyHsForm>) {
    setForm((current) => current ? { ...current, ...patch } : current);
  }

  async function saveForm() {
    if (!form || !canManage) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        hsCode: form.hsCode,
        cnName: form.cnName,
        enName: form.enName,
        unit: form.unit,
        rebateRate: form.rebateRate,
        vatRate: form.vatRate,
        keywords: form.keywords,
        remark: form.remark,
        isEnabled: form.isEnabled,
      };
      const path = form.id ? `/api/company-hs/${encodeURIComponent(form.id)}` : "/api/company-hs";
      const result = await apiJson<{ success?: boolean; item?: CompanyHsItem; message?: string }>(path, {
        method: form.id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (result.success !== true) throw new ApiRequestError(result.message || "保存企业HS编码失败", 400);
      setNotice(result.message || "企业HS编码已保存");
      setForm(emptyForm);
      await loadItems();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存企业HS编码失败");
    } finally {
      setSaving(false);
    }
  }

  async function disableItem(item: CompanyHsItem) {
    if (!canManage) return;
    const ok = window.confirm(`确认停用企业HS编码 ${item.hsCode}？停用后退税计算将不再匹配该编码。`);
    if (!ok) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/company-hs/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (result.success !== true) throw new ApiRequestError(result.message || "停用企业HS编码失败", 400);
      setNotice(result.message || "企业HS编码已停用");
      await loadItems();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "停用企业HS编码失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.taxTransportSummaryHeader}>
        <div>
          <h2>企业HS编码</h2>
          <p>维护企业常用报关 HS 编码、法定单位、退税率和 OCR 匹配关键字。</p>
        </div>
        <span className={styles.filterHint}>启用 {activeCount} / 当前 {items.length}</span>
      </div>

      {notice ? <div className={styles.successBanner}>{notice}</div> : null}
      {error ? <div className={styles.errorBanner}>{error}</div> : null}

      <div className={styles.taxTransportSummaryHeader}>
        <div className={styles.inlineFilterGroup}>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadItems();
            }}
            placeholder="搜索 HS编码 / 中文名 / 英文名 / 关键字"
          />
          <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void loadItems()}>
            {loading ? "查询中..." : "查询"}
          </button>
        </div>
        {canManage && featureEnabled ? (
          <button className={styles.primaryButtonCompact} type="button" onClick={() => setForm(emptyForm)}>新增HS编码</button>
        ) : null}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>HS编码</th>
              <th>中文报关名称</th>
              <th>英文名称</th>
              <th>法定单位</th>
              <th>退税率</th>
              <th>增值税率</th>
              <th>关键字</th>
              <th>状态</th>
              {canManage && featureEnabled ? <th>操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.hsCode}</strong></td>
                <td>{item.cnName || "-"}</td>
                <td>{item.enName || "-"}</td>
                <td>{item.unit || "-"}</td>
                <td>{percentText(item.rebateRate)}</td>
                <td>{percentText(item.vatRate)}</td>
                <td>{item.keywords || "-"}</td>
                <td>
                  <span className={`${styles.statusPill} ${item.isEnabled === false ? styles.statusWarning : styles.statusSuccess}`}>
                    {item.isEnabled === false ? "已停用" : "启用"}
                  </span>
                </td>
                {canManage && featureEnabled ? (
                  <td>
                    <div className={styles.rowActionGroup}>
                      <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => setForm(itemToForm(item))}>编辑</button>
                      <button className={styles.dangerButton} type="button" disabled={saving || item.isEnabled === false} onClick={() => void disableItem(item)}>停用</button>
                    </div>
                  </td>
                ) : null}
              </tr>
            )) : (
              <tr><td colSpan={canManage && featureEnabled ? 9 : 8}><div className={styles.emptyState}>{loading ? "正在读取企业HS编码..." : "暂无企业HS编码。"}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {form && canManage && featureEnabled ? (
        <div className={styles.documentGroupCard}>
          <div className={styles.taxTransportSummaryHeader}>
            <strong>{form.id ? "编辑HS编码" : "新增HS编码"}</strong>
            <button className={styles.secondaryButton} type="button" onClick={() => setForm(emptyForm)}>清空</button>
          </div>
          <div className={styles.detailGrid}>
            <label>HS编码<input value={form.hsCode} onChange={(event) => updateForm({ hsCode: event.target.value })} placeholder="10位数字" /></label>
            <label>中文报关名称<input value={form.cnName} onChange={(event) => updateForm({ cnName: event.target.value })} /></label>
            <label>英文名称<input value={form.enName} onChange={(event) => updateForm({ enName: event.target.value })} /></label>
            <label>法定单位<input value={form.unit} onChange={(event) => updateForm({ unit: event.target.value })} /></label>
            <label>出口退税率<input type="number" min="0" max="13" step="0.01" value={form.rebateRate} onChange={(event) => updateForm({ rebateRate: event.target.value })} /></label>
            <label>增值税率<input type="number" min="0" max="13" step="0.01" value={form.vatRate} onChange={(event) => updateForm({ vatRate: event.target.value })} /></label>
            <label>OCR匹配关键字<input value={form.keywords} onChange={(event) => updateForm({ keywords: event.target.value })} /></label>
            <label>备注<input value={form.remark} onChange={(event) => updateForm({ remark: event.target.value })} /></label>
          </div>
          <div className={styles.taxTransportSummaryHeader}>
            <label className={styles.checkboxLabel}><input type="checkbox" checked={form.isEnabled} onChange={(event) => updateForm({ isEnabled: event.target.checked })} /> 启用</label>
            <button className={styles.primaryButtonCompact} type="button" disabled={saving} onClick={() => void saveForm()}>
              {saving ? "保存中..." : "保存企业HS编码"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
