import type { Dispatch, SetStateAction } from "react";
import { ConfirmationDialog, PaginationBar, UiCheckbox, type ConfirmationDialogState } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { ShipsgoControlTowerView } from "./control-tower";
import { DomesticLogisticsRows } from "./rows";
import {
  ARCHIVE_BUTTON_DISABLED_TOOLTIP,
  ARCHIVE_BUTTON_RULE,
  ARCHIVE_SCOPE_OPTIONS,
  domesticLogisticsCanArchive,
  type DomesticLogisticsDocument,
  type DomesticLogisticsInfo,
  type DomesticLogisticsRow,
  type ShipsgoControlTowerRow,
  type ShipsgoFeatureFlags,
  type ShipsgoTrackingRow,
} from "./model";

type DomesticLogisticsModuleViewProps = {
  loading: boolean;
  error: string;
  notice: string;
  keyword: string;
  submittedKeyword: string;
  businessScope: string;
  page: number;
  totalPages: number;
  expandedId: string;
  editingOrderId: string;
  activeLogisticsView: "list" | "controlTower";
  shipsgoFeatures: ShipsgoFeatureFlags;
  pageRows: DomesticLogisticsRow[];
  rowsLength: number;
  selectedOrderIds: string[];
  selectedArchivableRows: DomesticLogisticsRow[];
  pageArchivableRows: DomesticLogisticsRow[];
  allPageArchivableSelected: boolean;
  tableColSpan: number;
  currentUserRole: string;
  canArchiveDomesticLogistics: boolean;
  canEditDomesticLogistics: boolean;
  canDeleteDomesticLogistics: boolean;
  canUploadCustomsDocuments: boolean;
  canDeleteCustomsDocuments: boolean;
  canCreateLogisticsExpense: boolean;
  canViewShipsgoControlTower: boolean;
  canManageShipsgoTracking: boolean;
  canDeleteShipsgoTracking: boolean;
  initialKeyword: string;
  initialOpenToken: number;
  initialControlTowerFullscreen: boolean;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  shipsgoBusyKey: string;
  confirmation: ConfirmationDialogState | null;
  setNotice: Dispatch<SetStateAction<string>>;
  setKeyword: Dispatch<SetStateAction<string>>;
  onPageChange: (page: number) => void;
  setExpandedId: Dispatch<SetStateAction<string>>;
  setEditingOrderId: Dispatch<SetStateAction<string>>;
  setActiveLogisticsView: Dispatch<SetStateAction<"list" | "controlTower">>;
  loadRows: (nextKeyword?: string, nextBusinessScope?: string, nextPage?: number) => Promise<DomesticLogisticsRow[]>;
  submitSearch: () => void;
  resetSearch: () => void;
  changeBusinessScope: (scope: string) => void;
  archiveSelectedOrders: () => Promise<void>;
  togglePageArchivableOrders: (checked: boolean) => void;
  toggleOrderSelection: (row: DomesticLogisticsRow, checked: boolean) => void;
  openLogisticsExpenseStatus: (row: DomesticLogisticsRow) => void;
  createShipsgoTracking: (row: DomesticLogisticsRow, payload?: { carrierScac?: string }) => Promise<void>;
  syncShipsgoTracking: (row: DomesticLogisticsRow, trackingId: string) => Promise<ShipsgoTrackingRow>;
  recoverShipsgoTracking: (row: DomesticLogisticsRow) => Promise<void>;
  deleteShipsgoTracking: (row: DomesticLogisticsRow, tracking: ShipsgoTrackingRow) => Promise<void>;
  openControlTowerOrder: (row: ShipsgoControlTowerRow) => Promise<void>;
  deleteDomesticLogistics: (row: DomesticLogisticsRow) => Promise<void>;
  onSaveDomesticLogisticsInfo: (row: DomesticLogisticsRow, info?: DomesticLogisticsInfo | null) => void;
  uploadDocument: (orderId: string, documentType: string, file: File | null) => Promise<void>;
  deleteDocument: (document: DomesticLogisticsDocument) => Promise<void>;
  onOpenLogisticsFees?: (focus: { keyword?: string; billId?: string }) => void;
  cancelConfirmation: () => void;
  confirmConfirmation: () => void;
  updateConfirmationInput: (value: string) => void;
};

export function DomesticLogisticsModuleView({
  loading,
  error,
  notice,
  keyword,
  submittedKeyword,
  businessScope,
  page,
  totalPages,
  expandedId,
  editingOrderId,
  activeLogisticsView,
  shipsgoFeatures,
  pageRows,
  rowsLength,
  selectedOrderIds,
  selectedArchivableRows,
  pageArchivableRows,
  allPageArchivableSelected,
  tableColSpan,
  currentUserRole,
  canArchiveDomesticLogistics,
  canEditDomesticLogistics,
  canDeleteDomesticLogistics,
  canUploadCustomsDocuments,
  canDeleteCustomsDocuments,
  canCreateLogisticsExpense,
  canViewShipsgoControlTower,
  canManageShipsgoTracking,
  canDeleteShipsgoTracking,
  initialKeyword,
  initialOpenToken,
  initialControlTowerFullscreen,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  shipsgoBusyKey,
  confirmation,
  setNotice,
  setKeyword,
  onPageChange,
  setExpandedId,
  setEditingOrderId,
  setActiveLogisticsView,
  loadRows,
  submitSearch,
  resetSearch,
  changeBusinessScope,
  archiveSelectedOrders,
  togglePageArchivableOrders,
  toggleOrderSelection,
  openLogisticsExpenseStatus,
  createShipsgoTracking,
  syncShipsgoTracking,
  recoverShipsgoTracking,
  deleteShipsgoTracking,
  openControlTowerOrder,
  deleteDomesticLogistics,
  onSaveDomesticLogisticsInfo,
  uploadDocument,
  deleteDocument,
  onOpenLogisticsFees,
  cancelConfirmation,
  confirmConfirmation,
  updateConfirmationInput,
}: DomesticLogisticsModuleViewProps) {
return (
    <>
    <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>物流信息</h2>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => {
            setNotice("");
            void loadRows();
          }}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className={styles.moduleViewTabs} role="tablist" aria-label="物流信息视图">
        <button
          className={activeLogisticsView === "list" ? styles.moduleViewTabActive : styles.moduleViewTab}
          type="button"
          role="tab"
          aria-selected={activeLogisticsView === "list"}
          onClick={() => setActiveLogisticsView("list")}
        >
          物流列表
        </button>
        {canViewShipsgoControlTower && shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
          <button
            className={activeLogisticsView === "controlTower" ? styles.moduleViewTabActive : styles.moduleViewTab}
            type="button"
            role="tab"
            aria-selected={activeLogisticsView === "controlTower"}
            onClick={() => setActiveLogisticsView("controlTower")}
          >
            运输监控
          </button>
        ) : null}
      </div>

      {activeLogisticsView === "controlTower" && canViewShipsgoControlTower && shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
        <ShipsgoControlTowerView
          features={shipsgoFeatures}
          canManage={canManageShipsgoTracking}
          initialKeyword={initialKeyword}
          initialOpenToken={initialOpenToken}
          initialFullScreen={initialControlTowerFullscreen}
          onOpenOrder={openControlTowerOrder}
        />
      ) : (
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
            disabled={loading || !selectedArchivableRows.length}
            title={selectedArchivableRows.length ? `批量归档 ${selectedArchivableRows.length} 个审核通过且已上传发票订单` : ARCHIVE_BUTTON_DISABLED_TOOLTIP}
            onClick={archiveSelectedOrders}
            data-rule={ARCHIVE_BUTTON_RULE.allow.join(",")}
          >
            批量归档{selectedArchivableRows.length ? `（${selectedArchivableRows.length}）` : ""}
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
                onToggle={() => setExpandedId((current) => {
                  const next = current === row.id ? "" : row.id;
                  if (!next) {
                    setEditingOrderId("");
                  }
                  return next;
                })}
                editing={editingOrderId === row.id}
                canEditDomesticLogistics={canEditDomesticLogistics}
                canUploadCustomsDocuments={canUploadCustomsDocuments}
                canDeleteCustomsDocuments={canDeleteCustomsDocuments}
                onEdit={() => {
                  setExpandedId(row.id);
                  setEditingOrderId((current) => current === row.id ? "" : row.id);
                }}
                canCreateLogisticsExpense={canCreateLogisticsExpense}
                currentUserRole={currentUserRole}
                onOpenExpenseStatus={() => openLogisticsExpenseStatus(row)}
                onOpenLogisticsFees={() => {
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
                onCancelEdit={() => setEditingOrderId("")}
                canDeleteDomesticLogistics={canDeleteDomesticLogistics}
                onDeleteDomesticLogistics={() => void deleteDomesticLogistics(row)}
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
      )}
    </section>
    {confirmation ? (
      <ConfirmationDialog
        state={confirmation}
        onCancel={cancelConfirmation}
        onConfirm={confirmConfirmation}
        onInputChange={updateConfirmationInput}
      />
    ) : null}
    </>
  );
}
