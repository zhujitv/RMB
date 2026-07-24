import { PaginationBar, UiCheckbox } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import {
  ARCHIVE_BUTTON_DISABLED_TOOLTIP,
  ARCHIVE_BUTTON_RULE,
  ARCHIVE_SCOPE_OPTIONS,
  domesticLogisticsCanArchive,
} from "./model";
import type { DomesticLogisticsModuleViewProps } from "./module-view-types";
import { DomesticLogisticsRows } from "./rows";

export function DomesticLogisticsListView({
  loading, error, notice, keyword, businessScope, page, totalPages, expandedId,
  editingOrderId, shipsgoFeatures, pageRows, rowsLength, selectedOrderIds,
  selectedArchivableRows, pageArchivableRows, allPageArchivableSelected,
  tableColSpan, currentUserRole, canArchiveDomesticLogistics,
  canEditDomesticLogistics, canDeleteDomesticLogistics, canUploadCustomsDocuments,
  canDeleteCustomsDocuments, canCreateLogisticsExpense, canManageShipsgoTracking,
  canDeleteShipsgoTracking, uploadingKey, uploadProgressByKey, deletingDocumentId,
  shipsgoBusyKey, archiving, setNotice, setKeyword, onPageChange, setExpandedId,
  setEditingOrderId, confirmDiscardEdit, submitSearch, resetSearch,
  changeBusinessScope, archiveSelectedOrders, togglePageArchivableOrders,
  toggleOrderSelection, openLogisticsExpenseStatus, createShipsgoTracking,
  syncShipsgoTracking, recoverShipsgoTracking, deleteShipsgoTracking,
  deleteDomesticLogistics, onSaveDomesticLogisticsInfo, uploadDocument,
  deleteDocument, onOpenLogisticsFees,
}: DomesticLogisticsModuleViewProps) {
  return (
    <>
      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 提单号 / 柜号 / 物流供应商"
        />
        <select value={businessScope} onChange={(event) => changeBusinessScope(event.target.value)} disabled={loading}>
          {ARCHIVE_SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
        {canArchiveDomesticLogistics ? (
          <button
            className={styles.primaryButtonCompact}
            type="button"
            disabled={loading || archiving || !selectedArchivableRows.length}
            title={selectedArchivableRows.length ? `批量归档 ${selectedArchivableRows.length} 个审核通过且已上传发票订单` : ARCHIVE_BUTTON_DISABLED_TOOLTIP}
            onClick={() => void archiveSelectedOrders()}
            data-rule={ARCHIVE_BUTTON_RULE.allow.join(",")}
          >
            {archiving ? "归档中..." : `批量归档${selectedArchivableRows.length ? `（${selectedArchivableRows.length}）` : ""}`}
          </button>
        ) : null}
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}
      <div className={`${styles.tableWrap} ${styles.logisticsCompactTableWrap}`}>
        <table className={`${styles.dataTable} ${styles.logisticsCompactTable} ${styles.domesticLogisticsListTable}`}>
          <colgroup>
            {canArchiveDomesticLogistics ? <col className={styles.selectionColumn} /> : null}
            <col className={styles.orderNoColumn} />
            <col className={styles.blNoColumn} />
            <col className={styles.customerColumn} />
            <col className={styles.destinationColumn} />
            <col className={styles.cargoColumn} />
            <col className={styles.logisticsStatusColumn} />
            <col className={styles.logisticsExpenseStatusColumn} />
            <col className={styles.detailActionColumn} />
          </colgroup>
          <thead>
            <tr>
              {canArchiveDomesticLogistics ? (
                <th className={styles.selectionColumn}>
                  <UiCheckbox
                    variant="table"
                    label="选择本页可归档订单"
                    checked={allPageArchivableSelected}
                    disabled={!pageArchivableRows.length}
                    title={pageArchivableRows.length ? "选择本页审核通过且已上传发票订单" : ARCHIVE_BUTTON_DISABLED_TOOLTIP}
                    onChange={(event) => togglePageArchivableOrders(event.target.checked)}
                  />
                </th>
              ) : null}
              <th className={styles.orderNoColumn}>订单号</th>
              <th className={styles.blNoColumn}>提单号 / B/L No.</th>
              <th className={styles.customerColumn}>客户简称</th>
              <th className={styles.destinationColumn}>到达地</th>
              <th className={styles.cargoColumn}>运输货物名称</th>
              <th className={styles.logisticsStatusColumn}>物流状态</th>
              <th className={styles.logisticsExpenseStatusColumn}>费用录入状态</th>
              <th className={styles.detailActionColumn}>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={tableColSpan}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : pageRows.length ? pageRows.map((row) => (
              <DomesticLogisticsRows
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                onToggle={() => {
                  const nextExpandedId = expandedId === row.id ? "" : row.id;
                  if (editingOrderId && nextExpandedId !== editingOrderId && !confirmDiscardEdit()) return;
                  setExpandedId(nextExpandedId);
                  if (editingOrderId && nextExpandedId !== editingOrderId) setEditingOrderId("");
                }}
                editing={editingOrderId === row.id}
                canEditDomesticLogistics={canEditDomesticLogistics}
                canUploadCustomsDocuments={canUploadCustomsDocuments}
                canDeleteCustomsDocuments={canDeleteCustomsDocuments}
                onEdit={() => {
                  const nextEditingOrderId = editingOrderId === row.id ? "" : row.id;
                  if (editingOrderId && nextEditingOrderId !== editingOrderId && !confirmDiscardEdit()) return;
                  setExpandedId(row.id);
                  setEditingOrderId(nextEditingOrderId);
                }}
                canCreateLogisticsExpense={canCreateLogisticsExpense}
                currentUserRole={currentUserRole}
                onOpenExpenseStatus={() => openLogisticsExpenseStatus(row)}
                onOpenLogisticsFees={() => {
                  if (editingOrderId && !confirmDiscardEdit()) return;
                  setExpandedId(row.id);
                  setEditingOrderId("");
                  onOpenLogisticsFees?.({
                    billId: row.logisticsExpenseBillId || "",
                    keyword: row.blNo || row.billOfLadingNo || row.orderNo || "",
                  });
                }}
                shipsgoFeatures={shipsgoFeatures}
                shipsgoBusyKey={shipsgoBusyKey}
                canManageShipsgoTracking={canManageShipsgoTracking}
                canDeleteShipsgoTracking={canDeleteShipsgoTracking}
                onCreateShipsgoTracking={(payload) => createShipsgoTracking(row, payload)}
                onSyncShipsgoTracking={(trackingId) => syncShipsgoTracking(row, trackingId)}
                onRecoverShipsgoTracking={() => recoverShipsgoTracking(row)}
                onDeleteShipsgoTracking={(tracking) => deleteShipsgoTracking(row, tracking)}
                onSaved={(info) => {
                  onSaveDomesticLogisticsInfo(row, info);
                  setNotice("物流信息已保存");
                  setEditingOrderId("");
                }}
                onCancelEdit={() => {
                  if (!confirmDiscardEdit()) return;
                  setEditingOrderId("");
                }}
                canDeleteDomesticLogistics={canDeleteDomesticLogistics}
                onDeleteDomesticLogistics={() => {
                  if (editingOrderId === row.id && !confirmDiscardEdit()) return;
                  if (editingOrderId === row.id) setEditingOrderId("");
                  void deleteDomesticLogistics(row);
                }}
                uploadingKey={uploadingKey}
                uploadProgressByKey={uploadProgressByKey}
                deletingDocumentId={deletingDocumentId}
                onUploadDocument={uploadDocument}
                onDeleteDocument={deleteDocument}
                selectionEnabled={canArchiveDomesticLogistics}
                selected={selectedOrderIds.includes(row.id)}
                selectDisabled={!domesticLogisticsCanArchive(row)}
                colSpan={tableColSpan}
                onSelect={(checked) => toggleOrderSelection(row, checked)}
              />
            )) : (
              <tr>
                <td colSpan={tableColSpan}><div className={styles.emptyState}>未找到匹配的物流信息订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={rowsLength} page={page} totalPages={totalPages} onPage={onPageChange} />

    </>
  );
}
