import { useState } from "react";
import { DetailField, PaginationBar, SideDetailDrawer } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import type { ApiPerformanceRow, AuditLogRow, CustomerRow, Pagination, SettingsTabKey, SupplierRow, TableColumn, UserRow } from "./types";
import { detailFieldsFor, drawerSubtitleFor, drawerTitleFor, valueFor } from "./helpers";
import { CustomerProductsManager } from "./customer-products-manager";

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
  onForceDeleteRejectedUser,
  forceDeletingRejectedUserId = "",
  canForceDeleteRejectedUsers = false,
  onPage,
}: {
  tab: SettingsTabKey;
  rows: Array<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>;
  columns: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>[];
  loading: boolean;
  pagination: Pagination;
  detailRow: CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow | null;
  onViewDetail: (row: CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow) => void;
  onCloseDetail: () => void;
  onEditCustomer: (customer: CustomerRow) => void;
  onEditUser: (user: UserRow) => void;
  onDeleteCustomer: (customer: CustomerRow) => void;
  onForceDeleteRejectedUser: (user: UserRow) => void;
  forceDeletingRejectedUserId?: string;
  canForceDeleteRejectedUsers?: boolean;
  onPage: (page: number) => void;
}) {
  const [productCustomer, setProductCustomer] = useState<CustomerRow | null>(null);
  const colSpan = columns.length + 1;
  const tableWrapClassName = tab === "suppliers"
    ? `${styles.tableWrap} ${styles.supplierSettingsTableWrap}`
    : `${styles.tableWrap} ${styles.tablePinnedTwoCols}`;
  const tableClassName = tab === "suppliers"
    ? `${styles.dataTable} ${styles.supplierSettingsTable}`
    : styles.dataTable;

  return (
    <>
      <div className={tableWrapClassName}>
        <table className={tableClassName}>
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
                onManageProducts={setProductCustomer}
                onEditUser={onEditUser}
                onForceDeleteRejectedUser={onForceDeleteRejectedUser}
                forceDeletingRejectedUserId={forceDeletingRejectedUserId}
                canForceDeleteRejectedUsers={canForceDeleteRejectedUsers}
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
          onManageProducts={setProductCustomer}
        />
      ) : null}
      {productCustomer ? <CustomerProductsManager customer={productCustomer} onClose={() => setProductCustomer(null)} /> : null}
    </>
  );
}

export function SettingsRows({
  tab,
  row,
  columns,
  onViewDetail,
  onManageProducts,
  onEditUser,
  onForceDeleteRejectedUser,
  forceDeletingRejectedUserId,
  canForceDeleteRejectedUsers,
}: {
  tab: SettingsTabKey;
  row: CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow;
  columns: TableColumn<CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow>[];
  onViewDetail: () => void;
  onManageProducts: (customer: CustomerRow) => void;
  onEditUser: (user: UserRow) => void;
  onForceDeleteRejectedUser: (user: UserRow) => void;
  forceDeletingRejectedUserId: string;
  canForceDeleteRejectedUsers: boolean;
}) {
  const rejectedUser = canForceDeleteRejectedUsers && tab === "users" && (row as UserRow).approvalStatus === "REJECTED";
  const userRow = row as UserRow;
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
        {columns.map((column) => {
          const value = valueFor(row, column);
          const isSupplierName = tab === "suppliers" && String(column.key) === "supplierName";
          return (
            <td key={String(column.key)} title={isSupplierName ? value : undefined}>
              {isSupplierName ? (
                <span className={styles.supplierSettingsName} title={value}>{value}</span>
              ) : value}
            </td>
          );
        })}
        <td>
          <div className={styles.rowActionGroup}>
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
            {tab === "customers" ? (
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onManageProducts(row as CustomerRow);
                }}
              >
                产品属性
              </button>
            ) : null}
            {rejectedUser ? (
              <button
                className={styles.dangerButton}
                type="button"
                disabled={forceDeletingRejectedUserId === userRow.id}
                onClick={(event) => {
                  event.stopPropagation();
                  onForceDeleteRejectedUser(userRow);
                }}
              >
                {forceDeletingRejectedUserId === userRow.id ? "删除中..." : "强制删除"}
              </button>
            ) : null}
          </div>
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
  onManageProducts,
}: {
  tab: SettingsTabKey;
  row: CustomerRow | SupplierRow | UserRow | AuditLogRow | ApiPerformanceRow;
  onClose: () => void;
  onEditCustomer: (customer: CustomerRow) => void;
  onDeleteCustomer: (customer: CustomerRow) => void;
  onManageProducts: (customer: CustomerRow) => void;
}) {
  const detailFields = detailFieldsFor(tab, row);
  const actions = tab === "customers"
    ? (
      <>
        <button className={styles.secondaryButton} type="button" onClick={() => onManageProducts(row as CustomerRow)}>产品属性</button>
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
