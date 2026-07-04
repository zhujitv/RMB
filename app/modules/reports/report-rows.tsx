import { DetailField, UiCheckbox } from "../../components";
import { customerDisplayName, customerLegalName } from "../../utils";
import styles from "../../WorkspaceShell.module.css";
import {
  HIDDEN_DETAIL_KEYS,
  type ReportColumn,
  type ReportRow,
} from "./model";

export function ReportRows({
  row,
  columns,
  visibleColumns,
  selected,
  expanded,
  onToggle,
  onSelect,
  onOpenRecord,
}: {
  row: ReportRow;
  columns: ReportColumn[];
  visibleColumns: ReportColumn[];
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onOpenRecord: () => void;
}) {
  const colSpan = visibleColumns.length + 2;
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td>
          <span onClick={(event) => event.stopPropagation()}>
            <UiCheckbox
              label="选择此行"
              variant="table"
              checked={selected}
              onChange={onSelect}
            />
          </span>
        </td>
        {visibleColumns.map((column) => (
          <td
            key={column.key}
            className={column.key === "businessEntityName" ? styles.businessEntityColumn : undefined}
            title={column.key === "businessEntityName" ? businessEntityFullName(row) : undefined}
          >
            {displayValue(row, column)}
          </td>
        ))}
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={colSpan}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenRecord(); }}>
                  查看详情
                </button>
              </div>
              <div className={styles.detailGrid}>
                {columns
                  .filter((column) => !HIDDEN_DETAIL_KEYS.has(column.key))
                  .map((column) => (
                    <DetailField
                      key={column.key}
                      label={column.label === "客户简称" ? "客户全称" : column.label}
                      value={column.label === "客户简称"
                        ? customerLegalName(row)
                        : String(row[column.key] ?? "-")}
                      wide={String(row[column.key] ?? "").length > 36}
                    />
                  ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function displayValue(row: ReportRow, column: ReportColumn) {
  const value = column.key === "businessEntityName"
    ? (row.businessEntityDisplayName || row.businessEntityShortName || businessEntityFullName(row))
    : column.label === "客户简称"
      ? customerDisplayName(row)
      : row[column.key];
  return String(value ?? "-");
}

function businessEntityFullName(row: ReportRow) {
  return String(row.businessEntityName || row.businessEntityNameSnapshot || "");
}
