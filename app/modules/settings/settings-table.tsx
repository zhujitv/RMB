import { DetailField, PaginationBar, SideDetailDrawer } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { AuditLogRow, CustomerRow, Pagination, SettingsTabKey, SupplierRow, TableColumn, UserRow } from "./types";
import { detailFieldsFor, drawerSubtitleFor, drawerTitleFor, valueFor } from "./helpers";

export function SettingsTable({
  tab,
  rows,
  columns,
  loading,
  pagination,
  detailRow,
  onViewDetail,
  onCloseDetail,
  onEditCustomer,
  onEditUser,
  onDeleteCustomer,
  onDeleteUser,
  onPage,
}: {
  tab: SettingsTabKey;
  rows: Array<CustomerRow | SupplierRow | UserRow | AuditLogRow>;
  columns: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  loading: boolean;
  pagination: Pagination;
  detailRow: CustomerRow | SupplierRow | UserRow | AuditLogRow | null;
  onViewDetail: (row: CustomerRow | SupplierRow | UserRow | AuditLogRow) => void;
  onCloseDetail: () => void;
  onEditCustomer: (customer: CustomerRow) => void;
  onEditUser: (user: UserRow) => void;
  onDeleteCustomer: (customer: CustomerRow) => void;
  onDeleteUser: (user: UserRow) => void;
  onPage: (page: number) => void;
}) {
  const colSpan = columns.length + 1;
  return (
    <>
      <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              {columns.map((column) => <th key={String(column.key)}>{column.label}</th>)}
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : rows.length ? rows.map((row) => (
              <SettingsRows
                key={row.id}
                tab={tab}
                row={row}
                columns={columns}
                onViewDetail={() => onViewDetail(row)}
                onEditUser={onEditUser}
              />
            )) : (
              <tr>
                <td colSpan={colSpan}><div className={styles.emptyState}>未找到匹配的数据</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar
        total={pagination.total}
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPage={onPage}
      />
      {detailRow && tab !== "users" && tab !== "suppliers" ? (
        <SettingsDetailDrawer
          tab={tab}
          row={detailRow}
          onClose={onCloseDetail}
          onEditCustomer={onEditCustomer}
          onDeleteCustomer={onDeleteCustomer}
        />
      ) : null}
    </>
  );
}

export function SettingsRows({
  tab,
  row,
  columns,
  onViewDetail,
  onEditUser,
}: {
  tab: SettingsTabKey;
  row: CustomerRow | SupplierRow | UserRow | AuditLogRow;
  columns: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow>[];
  onViewDetail: () => void;
  onEditUser: (user: UserRow) => void;
}) {
  const handlePrimaryAction = () => {
    if (tab === "users") {
      onEditUser(row as UserRow);
      return;
    }
    onViewDetail();
  };

  return (
    <>
      <tr className={styles.clickableRow} onClick={handlePrimaryAction}>
        {columns.map((column) => <td key={String(column.key)}>{valueFor(row, column)}</td>)}
        <td>
          <button
            className={styles.rowDetailButton}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handlePrimaryAction();
            }}
          >
            {tab === "users" || tab === "suppliers" ? "编辑" : "详情"}
          </button>
        </td>
      </tr>
    </>
  );
}

export function SettingsDetailDrawer({
  tab,
  row,
  onClose,
  onEditCustomer,
  onDeleteCustomer,
}: {
  tab: SettingsTabKey;
  row: CustomerRow | SupplierRow | UserRow | AuditLogRow;
  onClose: () => void;
  onEditCustomer: (customer: CustomerRow) => void;
  onDeleteCustomer: (customer: CustomerRow) => void;
}) {
  const detailFields = detailFieldsFor(tab, row);
  const actions = tab === "customers"
    ? (
      <>
        <button className={styles.primaryButtonCompact} type="button" onClick={() => onEditCustomer(row as CustomerRow)}>编辑客户</button>
        <button className={styles.dangerButton} type="button" onClick={() => onDeleteCustomer(row as CustomerRow)}>删除客户</button>
      </>
    )
    : undefined;

  return (
    <SideDetailDrawer
      ariaLabel="系统设置详情"
      kicker="系统设置"
      title={drawerTitleFor(tab, row)}
      subtitle={drawerSubtitleFor(tab, row)}
      actions={actions}
      onClose={onClose}
    >
      <div className={styles.detailGrid}>
        {detailFields.map((field) => (
          <DetailField key={field.label} label={field.label} value={field.value} wide={field.wide} />
        ))}
      </div>
    </SideDetailDrawer>
  );
}
