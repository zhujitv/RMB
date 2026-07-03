"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { apiJson } from "../../api";
import { SearchAutocomplete } from "../../SearchAutocomplete";
import styles from "../../WorkspaceShell.module.css";

type FactoryCostCandidate = {
  id: string;
  orderId?: string;
  orderNo?: string;
  billOfLadingNo?: string;
  supplierId?: string;
  supplierName?: string;
  supplierType?: string;
  costType?: string;
  currency?: string;
  amount?: number;
  amountCny?: number;
  createdAt?: string;
};

type CostCandidatesResponse = {
  costs?: FactoryCostCandidate[];
};

export type CreateSupplierDocumentRequestResult = {
  request?: {
    id?: string;
    sendStatus?: string;
  };
  message?: string;
};

const DOCUMENT_TYPE_OPTIONS = [
  { value: "SUPPLIER_PURCHASE_CONTRACT", label: "工厂采购合同", description: "上传供应商签章采购合同 PDF" },
  { value: "SUPPLIER_INVOICE", label: "工厂增值税发票", description: "上传供应商开具的增值税专用发票 PDF" },
];

const DEFAULT_DOCUMENT_TYPES = DOCUMENT_TYPE_OPTIONS.map((item) => item.value);
const EXCEL_TEMPLATE_MAX_SIZE = 5 * 1024 * 1024;
const EXCEL_TEMPLATE_ACCEPT = [
  ".xls",
  ".xlsx",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

export function CreateSupplierDocumentRequestDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateSupplierDocumentRequestResult) => void | Promise<void>;
}) {
  const [selectedCost, setSelectedCost] = useState<FactoryCostCandidate | null>(null);
  const [requiredTypes, setRequiredTypes] = useState<string[]>(DEFAULT_DOCUMENT_TYPES);
  const [dueDate, setDueDate] = useState("");
  const [message, setMessage] = useState("");
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function searchFactoryCosts(keyword: string) {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("q", keyword.trim());
    const result = await apiJson<CostCandidatesResponse>(
      `/api/supplier-document-requests/cost-candidates?${params}`,
    );
    return result.costs || [];
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!selectedCost?.id || !selectedCost.orderId || !selectedCost.supplierId) {
      setError("请选择已登记的工厂供应商成本。");
      return;
    }
    if (!requiredTypes.length) {
      setError("请至少选择一种需要回传的资料。");
      return;
    }
    const fileError = validateTemplateFile(templateFile);
    if (fileError) {
      setError(fileError);
      return;
    }
    const formData = new FormData();
    formData.append("costId", selectedCost.id);
    formData.append("orderId", selectedCost.orderId);
    formData.append("supplierId", selectedCost.supplierId);
    formData.append("requiredDocumentTypes", requiredTypes.join(","));
    formData.append("dueDate", dueDate);
    formData.append("message", message);
    formData.append("templateFile", templateFile as File);
    try {
      setSaving(true);
      const result = await apiJson<CreateSupplierDocumentRequestResult>("/api/supplier-document-requests", {
        method: "POST",
        body: formData,
      });
      await onCreated(result);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "发起资料回传通知失败");
    } finally {
      setSaving(false);
    }
  }

  function toggleRequiredType(value: string, checked: boolean) {
    setRequiredTypes((current) => {
      if (checked) return current.includes(value) ? current : [...current, value];
      return current.filter((item) => item !== value);
    });
  }

  return (
    <div
      className={styles.modalOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className={`${styles.modalCard} ${styles.supplierDocumentRequestDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-document-request-title"
        onSubmit={submitRequest}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="supplier-document-request-title">发起资料回传通知</h2>
            <p>先登记工厂供应商成本，再上传回传表格并邮件通知供应商。</p>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={saving}>关闭</button>
        </div>

        {error ? <div className={styles.inlineError}>{error}</div> : null}

        <div className={styles.reportFilterGrid}>
          <label className={styles.supplierDocumentRequestCostField}>
            已登记工厂成本
            <SearchAutocomplete
              value={selectedCost}
              cacheKey="supplier-document-request-costs"
              emptyLabel="未找到可创建资料回传的工厂供应商成本"
              placeholder="输入订单号 / 提单号 / 供应商 / 成本类型"
              searchOnFocus
              getLabel={costCandidateLabel}
              getDescription={costCandidateDescription}
              search={searchFactoryCosts}
              onSelect={setSelectedCost}
            />
          </label>
          <label>
            截止日期
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <label>
            回传表格 Excel
            <input
              name="templateFile"
              type="file"
              accept={EXCEL_TEMPLATE_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                setTemplateFile(file);
                const fileError = validateTemplateFile(file);
                if (fileError) setError(fileError);
              }}
              required
            />
          </label>
          <fieldset className={styles.supplierDocumentRequestTypes}>
            <legend>需要回传的资料</legend>
            {DOCUMENT_TYPE_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="checkbox"
                aria-checked={requiredTypes.includes(item.value)}
                aria-describedby={`${item.value}-description`}
                className={[
                  styles.supplierDocumentRequestTypeCard,
                  requiredTypes.includes(item.value) ? styles.supplierDocumentRequestTypeCardSelected : "",
                ].filter(Boolean).join(" ")}
                onClick={() => toggleRequiredType(item.value, !requiredTypes.includes(item.value))}
                disabled={saving}
              >
                <span className={styles.supplierDocumentRequestTypeCheck} aria-hidden="true">✓</span>
                <span className={styles.supplierDocumentRequestTypeText}>
                  <span className={styles.supplierDocumentRequestTypeTitle}>{item.label}</span>
                  <span id={`${item.value}-description`} className={styles.supplierDocumentRequestTypeDescription}>
                    {item.description}
                  </span>
                </span>
              </button>
            ))}
          </fieldset>
          <label className={styles.supplierDocumentRequestMessage}>
            通知备注
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="可选，供应商会在邮件中看到此备注"
              maxLength={1000}
              rows={4}
            />
          </label>
        </div>

        <div className={styles.quickCreateMeta}>
          <span>只能基于成本管理中已登记的工厂供应商成本创建。</span>
          <span>回传表格支持 .xls / .xlsx，单个文件最大 5MB；供应商回传资料仍只支持 PDF。</span>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={saving}>取消</button>
          <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>
            {saving ? "发送中..." : "发送通知"}
          </button>
        </div>
      </form>
    </div>
  );
}

function validateTemplateFile(file: File | null) {
  if (!file) return "请上传回传表格 Excel。";
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xls") && !lowerName.endsWith(".xlsx")) {
    return "回传表格仅支持 .xls 或 .xlsx 文件。";
  }
  if (file.size > EXCEL_TEMPLATE_MAX_SIZE) return "回传表格不能超过 5MB。";
  return "";
}

function costCandidateLabel(cost: FactoryCostCandidate) {
  return [
    cost.orderNo || "未编号",
    cost.supplierName || "未命名供应商",
    cost.costType || "工厂成本",
    moneyLabel(cost.currency, cost.amount),
  ].filter(Boolean).join(" / ");
}

function costCandidateDescription(cost: FactoryCostCandidate) {
  const parts = [
    cost.billOfLadingNo ? `提单号 ${cost.billOfLadingNo}` : "",
    cost.supplierType || "",
    `折人民币 ${moneyLabel("CNY", cost.amountCny)}`,
  ].filter(Boolean);
  return parts.join(" / ");
}

function moneyLabel(currency = "CNY", amount: number | undefined) {
  const numeric = Number(amount || 0);
  return `${currency || "CNY"} ${numeric.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
