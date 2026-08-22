"use client";

import { useState } from "react";
import styles from "../../WorkspaceShell.module.css";
import type { SupplierTaxContractDraftItem } from "./types";

type EditableRow = SupplierTaxContractDraftItem & { editorKey: string };
type EditableField = "productName" | "quantity" | "unit" | "unitPriceWithTax" | "amountWithTax";
const CELL_INPUT_STYLE = { width: "100%", minWidth: 110, minHeight: 38, boxSizing: "border-box" as const, border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 8px", background: "#fff" };

function initialRows(items: SupplierTaxContractDraftItem[]): EditableRow[] {
  return items.map((item, index) => ({
    ...item,
    editorKey: item.rowId || item.purchaseOrderItemId || `existing-${index + 1}`,
  }));
}

function payloadRows(rows: EditableRow[]): SupplierTaxContractDraftItem[] {
  return rows.map(({ editorKey: _editorKey, ...row }) => row);
}

export function ContractDraftEditor({ items, busy, onSave, onDirtyChange }: {
  items: SupplierTaxContractDraftItem[];
  busy: boolean;
  onSave: (items: SupplierTaxContractDraftItem[]) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [rows, setRows] = useState<EditableRow[]>(() => initialRows(items));
  const [dirty, setDirty] = useState(false);

  function markDirty() {
    if (dirty) return;
    setDirty(true);
    onDirtyChange(true);
  }

  function updateRow(index: number, field: EditableField, value: string) {
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
    markDirty();
  }

  function addRow() {
    const nextLine = rows.length + 1;
    setRows((current) => [...current, {
      editorKey: crypto.randomUUID(),
      rowId: crypto.randomUUID(),
      lineNo: nextLine,
      customsItemNo: String(nextLine),
      purchaseOrderItemId: "",
      customsCommodityCode: "",
      productName: "",
      quantity: "",
      unit: "",
      unitPriceWithTax: "",
      amountWithTax: "",
    }]);
    markDirty();
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
    markDirty();
  }

  async function save() {
    try {
      await onSave(payloadRows(rows));
      setDirty(false);
      onDirtyChange(false);
    } catch {
      // The parent renders server-side validation while retaining unsaved edits.
    }
  }

  return (
    <>
      <p><b>人工核对表：</b>品名、数量、单位、单价和总价可修改，也可增行或删行；保存后的人工数据是合同生成依据，OCR 仅作预填参考。</p>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable} style={{ minWidth: 980, tableLayout: "auto" }}>
          <thead>
            <tr>
              <th>品名</th><th>数量</th><th>单位</th><th>单价</th><th>总价</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={item.editorKey}>
                <td><input style={CELL_INPUT_STYLE} aria-label={`第${index + 1}行品名`} value={item.productName || ""} maxLength={200} onChange={(event) => updateRow(index, "productName", event.target.value)} disabled={busy} /></td>
                <td><input style={CELL_INPUT_STYLE} aria-label={`第${index + 1}行数量`} inputMode="decimal" value={item.quantity || ""} onChange={(event) => updateRow(index, "quantity", event.target.value)} disabled={busy} /></td>
                <td><input style={CELL_INPUT_STYLE} aria-label={`第${index + 1}行单位`} value={item.unit || ""} maxLength={40} onChange={(event) => updateRow(index, "unit", event.target.value)} disabled={busy} /></td>
                <td><input style={CELL_INPUT_STYLE} aria-label={`第${index + 1}行单价`} inputMode="decimal" value={item.unitPriceWithTax || ""} onChange={(event) => updateRow(index, "unitPriceWithTax", event.target.value)} disabled={busy} /></td>
                <td><input style={CELL_INPUT_STYLE} aria-label={`第${index + 1}行总价`} inputMode="decimal" value={item.amountWithTax || ""} onChange={(event) => updateRow(index, "amountWithTax", event.target.value)} disabled={busy} /></td>
                <td><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => removeRow(index)}>删除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.supplierDocumentNoticeActions} style={{ flexWrap: "wrap" }}>
        <button className={styles.secondaryButton} type="button" disabled={busy} onClick={addRow}>增加一行</button>
        <button className={styles.primaryButtonCompact} type="button" disabled={busy} onClick={save}>确认并保存人工核对结果</button>
        {dirty ? <span>修改尚未保存，保存后才能审核通过。</span> : <span>已保存；原始 OCR 快照仍保留用于审计。</span>}
      </div>
    </>
  );
}
