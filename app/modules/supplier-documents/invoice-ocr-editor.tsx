"use client";

import { useState } from "react";
import styles from "../../WorkspaceShell.module.css";
import type { SupplierInvoiceData, SupplierInvoiceHeader, SupplierInvoiceItem } from "./types";

type EditableInvoiceItem = SupplierInvoiceItem & { editorKey: string };
type InvoiceItemField = "name" | "quantity" | "unit" | "unitPrice" | "amountWithTax";
const CELL_INPUT_STYLE = { width: "100%", minWidth: 110, minHeight: 38, boxSizing: "border-box" as const, border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 8px", background: "#fff" };

const HEADER_FIELDS: Array<{ key: keyof SupplierInvoiceHeader; label: string }> = [
  { key: "invoiceName", label: "发票名称" },
  { key: "invoiceCode", label: "发票代码" },
  { key: "invoiceNo", label: "发票号码" },
  { key: "invoiceDate", label: "开票日期" },
  { key: "sellerName", label: "销售方名称" },
  { key: "sellerTaxNo", label: "销售方纳税人识别号" },
  { key: "buyerName", label: "购买方名称" },
  { key: "buyerTaxNo", label: "购买方纳税人识别号" },
  { key: "amountWithoutTax", label: "合计金额（不含税）" },
  { key: "taxAmount", label: "合计税额" },
  { key: "amountWithTax", label: "价税合计" },
  { key: "checkCode", label: "校验码" },
];

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function initialHeader(invoice?: SupplierInvoiceData | null): SupplierInvoiceHeader {
  return Object.fromEntries(HEADER_FIELDS.map(({ key }) => [key, text(invoice?.header?.[key])])) as SupplierInvoiceHeader;
}

function initialItems(invoice?: SupplierInvoiceData | null): EditableInvoiceItem[] {
  return (invoice?.items || []).map((item, index) => ({
    ...Object.fromEntries(Object.entries(item).map(([key, value]) => [key, text(value)])),
    amountWithTax: item.amountWithTax || lineTotal(item),
    editorKey: item.rowId || `invoice-existing-${index + 1}`,
  }));
}

function lineTotal(item: SupplierInvoiceItem) {
  const amount = Number(String(item.amountWithoutTax || "").replace(/[,，\s]/g, ""));
  const tax = Number(String(item.taxAmount || "").replace(/[,，\s]/g, ""));
  return Number.isFinite(amount) && Number.isFinite(tax) ? (amount + tax).toFixed(2) : "";
}

export function InvoiceOcrEditor({ invoice, busy, onSave, onDirtyChange }: {
  invoice?: SupplierInvoiceData | null;
  busy: boolean;
  onSave: (invoice: { header: SupplierInvoiceHeader; items: SupplierInvoiceItem[] }) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [header] = useState<SupplierInvoiceHeader>(() => initialHeader(invoice));
  const [items, setItems] = useState<EditableInvoiceItem[]>(() => initialItems(invoice));
  const [dirty, setDirty] = useState(false);

  function markDirty() {
    if (dirty) return;
    setDirty(true);
    onDirtyChange(true);
  }

  function updateItem(index: number, field: InvoiceItemField, value: string) {
    setItems((current) => current.map((item, rowIndex) => (
      rowIndex === index ? { ...item, [field]: value } : item
    )));
    markDirty();
  }

  function addItem() {
    const id = crypto.randomUUID();
    setItems((current) => [...current, {
      editorKey: id,
      rowId: id,
      lineNo: String(current.length + 1),
      name: "",
      spec: "",
      unit: "",
      quantity: "",
      unitPrice: "",
      amountWithoutTax: "",
      taxRate: "",
      taxAmount: "",
      amountWithTax: "",
      taxClassifyCode: "",
    }]);
    markDirty();
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, rowIndex) => rowIndex !== index));
    markDirty();
  }

  async function save() {
    try {
      await onSave({
        header,
        items: items.map(({ editorKey: _editorKey, ...item }, index) => ({
          ...item,
          lineNo: item.lineNo || String(index + 1),
        })),
      });
      setDirty(false);
      onDirtyChange(false);
    } catch {
      // The parent keeps the editor dirty and shows the server validation message.
    }
  }

  return (
    <div className={styles.supplierDocumentUploadBody}>
      <p><b>发票人工核对：</b>OCR 仅辅助预填。品名、数量、单位、单价和总价可修改，也可增行或删行；保存后的人工数据作为匹配和递交依据。</p>
      <p>发票号码：{header.invoiceNo || "-"} · 销售方：{header.sellerName || "-"} · 购买方：{header.buyerName || "-"}</p>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable} style={{ minWidth: 980, tableLayout: "auto" }}>
          <thead>
            <tr>
              <th>品名</th><th>数量</th><th>单位</th><th>单价</th><th>总价</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.editorKey}>
                <td><input style={CELL_INPUT_STYLE} aria-label={`发票第${index + 1}行品名`} value={item.name || ""} maxLength={200} onChange={(event) => updateItem(index, "name", event.target.value)} disabled={busy} /></td>
                <td><input style={CELL_INPUT_STYLE} aria-label={`发票第${index + 1}行数量`} inputMode="decimal" value={item.quantity || ""} onChange={(event) => updateItem(index, "quantity", event.target.value)} disabled={busy} /></td>
                <td><input style={CELL_INPUT_STYLE} aria-label={`发票第${index + 1}行单位`} value={item.unit || ""} maxLength={40} onChange={(event) => updateItem(index, "unit", event.target.value)} disabled={busy} /></td>
                <td><input style={CELL_INPUT_STYLE} aria-label={`发票第${index + 1}行单价`} inputMode="decimal" value={item.unitPrice || ""} onChange={(event) => updateItem(index, "unitPrice", event.target.value)} disabled={busy} /></td>
                <td><input style={CELL_INPUT_STYLE} aria-label={`发票第${index + 1}行总价`} inputMode="decimal" value={item.amountWithTax || ""} onChange={(event) => updateItem(index, "amountWithTax", event.target.value)} disabled={busy} /></td>
                <td><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => removeItem(index)}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.supplierDocumentNoticeActions} style={{ flexWrap: "wrap" }}>
        <button className={styles.secondaryButton} type="button" disabled={busy} onClick={addItem}>增加商品行</button>
        <button className={styles.primaryButtonCompact} type="button" disabled={busy || !dirty} onClick={save}>保存发票人工核对结果</button>
        {dirty ? <span>修改尚未保存，保存后才能确认发票。</span> : <span>已保存；系统同时保留原始 OCR 数据和人工修改记录。</span>}
      </div>
    </div>
  );
}
