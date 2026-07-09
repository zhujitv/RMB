import styles from "../../WorkspaceShell.module.css";
import type {
  PaymentInstallment,
  QuickOrderForm,
  SalespersonOption,
  SupplierOption,
} from "./model";
import {
  installmentTotal,
  supplierName,
} from "./utils";

type QuickOrderValueSetter = <K extends keyof QuickOrderForm>(key: K, value: QuickOrderForm[K]) => void;

export function OrderAssignmentFields({
  form,
  salespeople,
  onSalespersonChange,
}: {
  form: QuickOrderForm;
  salespeople: SalespersonOption[];
  onSalespersonChange: (salespersonUserId: string) => void;
}) {
  return (
    <label>
      业务员
      <select value={form.salespersonUserId} onChange={(event) => onSalespersonChange(event.target.value)}>
        <option value="">未分配</option>
        {salespeople.map((user) => (
          <option key={user.id} value={user.id}>{user.name}{user.role ? ` · ${user.role}` : ""}</option>
        ))}
      </select>
    </label>
  );
}

export function LogisticsSupplierField({
  allowMultipleLogisticsSuppliers,
  defaultLogisticsSupplier,
  form,
  isExwOrder = false,
  logisticsSuppliers,
  selectedIds,
  setFormValue,
}: {
  allowMultipleLogisticsSuppliers: boolean;
  defaultLogisticsSupplier: SupplierOption | null;
  form: QuickOrderForm;
  isExwOrder?: boolean;
  logisticsSuppliers: SupplierOption[];
  selectedIds: string[];
  setFormValue: QuickOrderValueSetter;
}) {
  return (
    <label className={styles.autocompleteField}>
      {isExwOrder ? "物流供应商（选填）" : "物流供应商"}
      <select
        multiple={allowMultipleLogisticsSuppliers}
        size={allowMultipleLogisticsSuppliers ? 4 : 1}
        value={allowMultipleLogisticsSuppliers ? form.logisticsSupplierIds : (selectedIds[0] || "")}
        disabled={!logisticsSuppliers.length && !isExwOrder}
        onChange={(event) => setFormValue("logisticsSupplierIds", Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
      >
        {!allowMultipleLogisticsSuppliers ? <option value="">{isExwOrder ? "未指定" : "请选择物流供应商"}</option> : null}
        {logisticsSuppliers.length ? logisticsSuppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplierName(supplier)} · {supplier.supplierType || "-"}{supplier.isDefaultLogisticsSupplier ? " · 默认" : ""}
          </option>
        )) : <option value="">{isExwOrder ? "暂无可选物流供应商，可不指定" : "请先设置默认物流供应商"}</option>}
      </select>
      <small className={styles.mutedText}>
        {isExwOrder
          ? "EXW 条款下可不指定物流供应商"
          : allowMultipleLogisticsSuppliers
          ? "可多选物流、报关、海运或港杂费用供应商。"
          : defaultLogisticsSupplier
            ? "默认供应商会自动带出，也可以为本订单单独切换；不会修改系统默认供应商。"
            : "请选择本订单物流供应商。"}
      </small>
    </label>
  );
}

export function PaymentInstallmentsEditor({
  rows,
  onChange,
}: {
  rows: PaymentInstallment[];
  onChange: (rows: PaymentInstallment[]) => void;
}) {
  function setInstallment(index: number, key: keyof PaymentInstallment, value: string) {
    onChange(rows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [key]: value } : row
    )));
  }

  function removeInstallment(index: number) {
    const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
    onChange(nextRows.length ? nextRows : [{ ratio: "100", condition: "按约定付款" }]);
  }

  return (
    <div className={`${styles.installmentPanel} ${styles.autocompleteField}`}>
      <div className={styles.panelHead}>
        <h3>分批付款节点</h3>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => onChange([...rows, { ratio: "", condition: "" }])}
        >
          添加节点
        </button>
      </div>
      {rows.map((row, index) => (
        <div key={`${index}-${row.condition}`} className={styles.installmentRow}>
          <label>
            比例%
            <input value={row.ratio} onChange={(event) => setInstallment(index, "ratio", event.target.value)} inputMode="decimal" />
          </label>
          <label>
            付款条件
            <input value={row.condition} onChange={(event) => setInstallment(index, "condition", event.target.value)} placeholder="例如 发货前 / 见提单" />
          </label>
          <button className={styles.secondaryButton} type="button" onClick={() => removeInstallment(index)}>删除</button>
        </div>
      ))}
      <small className={styles.mutedText}>当前合计：{installmentTotal(rows)}%</small>
    </div>
  );
}
