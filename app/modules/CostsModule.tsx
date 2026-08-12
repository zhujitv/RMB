"use client";
import { useState } from "react";
import { useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import { canVoidCost, isVoidedCost } from "./costs/helpers";
import { PAGE_SIZE, type CostRow } from "./costs/model";
import { CostsModuleView } from "./costs/module-view";
import { useCostDocumentActions } from "./costs/use-cost-document-actions";
import { useCostDrawerState } from "./costs/use-cost-drawer-state";
import { useCostWorkspacePresentation } from "./costs/use-cost-workspace-presentation";
import { useCostsListController } from "./costs/use-costs-list-controller";
import { useInitialCostFocus } from "./costs/use-initial-cost-focus";
import { usePaymentVoucherPreview } from "./costs/use-payment-voucher-preview";
export function CostsModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialCostId = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialCostId?: string;
  initialOpenToken?: number;
}) {
  const {
    detailCost, setDetailCost, detailOrderSummary, setDetailOrderSummary,
    detailInvoiceGroup, setDetailInvoiceGroup, costFormDrawer, setCostFormDrawer,
    returnDetailCost, setReturnDetailCost, documentCost, setDocumentCost,
    documentLoading, setDocumentLoading, documentError, setDocumentError,
    uploadingKey, setUploadingKey, paymentSavingId, setPaymentSavingId,
    costTypeSavingId, setCostTypeSavingId, voucherUploadingKey, setVoucherUploadingKey,
    voucherPreviewCost, setVoucherPreviewCost, uploadProgressByKey, setUploadProgressByKey,
    deletingDocumentId, setDeletingDocumentId, deletingId, setDeletingId,
    clearTransientState, openCreateCostDrawer, openEditCostDrawer, openCopyCostDrawer,
    closeCostFormDrawer, closeDocumentsDrawer,
  } = useCostDrawerState();
  const [selectedCostIds, setSelectedCostIds] = useState<string[]>([]);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canWriteCosts = canWritePermission(currentUser, permissions, "costs", ["管理员", "业务员"]);
  const canWriteDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "财务", "业务员"]);
  const canWritePayments = canWritePermission(currentUser, permissions, "payments", ["管理员", "财务"]);
  const canAdminCostLifecycle = canWriteCosts && currentUser.role === "管理员";
  const canManageFactoryPayments = canWritePayments && ["管理员", "财务"].includes(currentUser.role);
  const canManageCostType = canWriteCosts && ["管理员", "财务"].includes(currentUser.role);
  const {
    rows,
    orderRows,
    invoiceGroupRows,
    total,
    page,
    filters,
    submittedFilters,
    costView,
    archiveScope,
    loading,
    error,
    notice,
    totalPages,
    activeRows,
    setRows,
    setOrderRows,
    setTotal,
    setError,
    setNotice,
    loadCosts,
    setFilter,
    submitSearch,
    resetSearch,
    gotoPage,
    changeArchiveScope,
    changeCostView,
    costMatchesSubmittedFilters,
    refreshCostAggregatesInBackground,
  } = useCostsListController({ initialKeyword, initialOpenToken, clearTransientState });
  function mergeCostRows(saved: CostRow | CostRow[] | null | undefined) {
    const savedRows = (Array.isArray(saved) ? saved : saved ? [saved] : []).filter((item): item is CostRow => Boolean(item?.id));
    if (!savedRows.length) return;
    setRows((current) => {
      let next = current;
      savedRows.forEach((cost) => {
        const exists = next.some((item) => item.id === cost.id);
        const shouldShow = costMatchesSubmittedFilters(cost);
        next = exists
          ? shouldShow
            ? next.map((item) => item.id === cost.id ? { ...item, ...cost } : item)
            : next.filter((item) => item.id !== cost.id)
          : page === 1 && shouldShow ? [cost, ...next].slice(0, PAGE_SIZE) : next;
      });
      return next;
    });
    setDetailCost((current) => {
      if (!current) return current;
      const matched = savedRows.find((cost) => cost.id === current.id);
      return matched ? { ...current, ...matched } : current;
    });
    setDocumentCost((current) => {
      if (!current) return current;
      const matched = savedRows.find((cost) => cost.id === current.id);
      return matched ? { ...current, ...matched } : current;
    });
  }
  const {
    fetchCostDetail,
    openCostDocuments,
    openInvoiceGroupDocuments,
    uploadCostDocument,
    updateCostType,
    updateProductSupplierCostPayment,
    uploadPaymentVoucher,
    deleteCostDocument,
    voidCost,
    deleteCost,
    restoreCost,
    batchVoidCosts,
  } = useCostDocumentActions({
    rows,
    setRows,
    setOrderRows,
    setDetailCost,
    setDetailOrderSummary,
    setDetailInvoiceGroup,
    setCostFormDrawer,
    setDocumentCost,
    setDocumentLoading,
    setDocumentError,
    setUploadingKey,
    setPaymentSavingId,
    setCostTypeSavingId,
    setVoucherUploadingKey,
    setVoucherPreviewCost,
    setUploadProgressByKey,
    setDeletingDocumentId,
    setDeletingId,
    setError,
    setNotice,
    costView,
    page,
    submittedFilters,
    archiveScope,
    canManageFactoryPayments,
    loadCosts,
    requestConfirmation,
  });
  useInitialCostFocus({ costId: initialCostId, openToken: initialOpenToken, openCost: openCostDocuments });
  const openPaymentVoucherPreview = usePaymentVoucherPreview({
    fetchCostDetail, setVoucherPreviewCost, setError,
  });
  const selectedCosts = canAdminCostLifecycle
    ? rows.filter((cost) => selectedCostIds.includes(cost.id) && canVoidCost(cost))
    : [];
  function toggleCostSelection(costId: string, selected: boolean) {
    if (!canAdminCostLifecycle) return;
    setSelectedCostIds((current) => selected
      ? [...new Set([...current, costId])]
      : current.filter((id) => id !== costId));
  }
  function toggleAllVisibleCosts(selected: boolean) {
    if (!canAdminCostLifecycle) return;
    const selectableIds = rows.filter((cost) => canVoidCost(cost)).map((cost) => cost.id);
    setSelectedCostIds(selected ? selectableIds : []);
  }
  async function handleBatchVoid() {
    if (!canAdminCostLifecycle) return;
    await batchVoidCosts(selectedCosts);
    setSelectedCostIds([]);
  }

  async function handleCostFormSaved(saved: CostRow | CostRow[] | null | undefined) {
    const savedDrawer = costFormDrawer;
    const detailToRestore = returnDetailCost;
    const savedRows = (Array.isArray(saved) ? saved : saved ? [saved] : []).filter((item): item is CostRow => Boolean(item?.id));
    const restoredDetail = detailToRestore
      ? savedRows.find((item) => item.id === detailToRestore.id)
      : null;
    setCostFormDrawer(null);
    setReturnDetailCost(null);
    setDetailCost(detailToRestore ? { ...detailToRestore, ...(restoredDetail || {}) } : null);
    setDetailOrderSummary(null);
    mergeCostRows(saved);
    setSelectedCostIds((current) => current.filter((id) => !savedRows.some((cost) => cost.id === id && isVoidedCost(cost))));
    if (savedDrawer?.mode === "edit") {
      const removedCount = costView === "details"
        ? savedRows.filter((cost) => rows.some((row) => row.id === cost.id) && !costMatchesSubmittedFilters(cost)).length
        : 0;
      if (removedCount) setTotal((current) => Math.max(0, current - removedCount));
      setNotice("成本已更新");
    } else {
      const count = costView === "details"
        ? savedRows.filter((cost) => costMatchesSubmittedFilters(cost)).length
        : savedRows.length;
      if (costView === "details" && count) setTotal((current) => current + count);
      setNotice("成本已保存");
    }
    if (costView !== "details") refreshCostAggregatesInBackground();
  }

  useCostWorkspacePresentation({
    costFormDrawer, documentCost, detailCost, detailOrderSummary, detailInvoiceGroup,
    page, submittedFilters, archiveScope, costView, loadCosts,
  });

  return (
    <CostsModuleView
      rows={rows}
      orderRows={orderRows}
      invoiceGroupRows={invoiceGroupRows}
      activeRows={activeRows}
      filters={filters}
      archiveScope={archiveScope}
      costView={costView}
      loading={loading}
      error={error}
      notice={notice}
      total={total}
      page={page}
      totalPages={totalPages}
      deletingId={deletingId}
      selectedCostIds={selectedCostIds}
      selectedVoidableCount={selectedCosts.length}
      detailCost={detailCost}
      detailOrderSummary={detailOrderSummary}
      detailInvoiceGroup={detailInvoiceGroup}
      costFormDrawer={costFormDrawer}
      documentCost={documentCost}
      documentLoading={documentLoading}
      documentError={documentError}
      uploadingKey={uploadingKey}
      uploadProgressByKey={uploadProgressByKey}
      deletingDocumentId={deletingDocumentId}
      canWriteDocuments={canWriteDocuments}
      canWriteCosts={canWriteCosts}
      canAdminCostLifecycle={canAdminCostLifecycle}
      canManageCostType={canManageCostType}
      canManageFactoryPayments={canManageFactoryPayments}
      costTypeSavingId={costTypeSavingId}
      paymentSavingId={paymentSavingId}
      voucherUploadingKey={voucherUploadingKey}
      voucherPreviewCost={voucherPreviewCost}
      confirmation={confirmation}
      onCreateCost={openCreateCostDrawer}
      onRefresh={() => {
        setNotice("");
        void loadCosts(page, submittedFilters, archiveScope, costView);
      }}
      onChangeView={changeCostView}
      onChangeArchiveScope={changeArchiveScope}
      onSetFilter={setFilter}
      onSubmitSearch={submitSearch}
      onResetSearch={resetSearch}
      onPage={gotoPage}
      onSetDetailCost={setDetailCost}
      onSetOrderDetail={setDetailOrderSummary}
      onSetInvoiceGroupDetail={setDetailInvoiceGroup}
      onEditCost={openEditCostDrawer}
      onCopyCost={openCopyCostDrawer}
      onVoidCost={(cost) => void voidCost(cost)}
      onDeleteCost={(cost) => void deleteCost(cost)}
      onRestoreCost={(cost) => { if (canAdminCostLifecycle) void restoreCost(cost); }}
      onToggleCostSelection={toggleCostSelection}
      onToggleAllVisibleCosts={toggleAllVisibleCosts}
      onBatchVoid={() => void handleBatchVoid()}
      onOpenDocuments={(costId) => void openCostDocuments(costId)}
      onOpenInvoiceGroupDocuments={(group) => void openInvoiceGroupDocuments(group)}
      onOpenPaymentVoucher={openPaymentVoucherPreview}
      onCloseCostForm={closeCostFormDrawer}
      onCostFormSaved={handleCostFormSaved}
      onCloseDocuments={closeDocumentsDrawer}
      onUploadDocument={(cost, documentType, file) => {
        if (file) void uploadCostDocument(cost, documentType, file);
      }}
      onUpdateCostType={(cost, costType, reason) => void updateCostType(cost, costType, reason)}
      onUpdatePayment={(cost, paid, paidAt) => void updateProductSupplierCostPayment(cost, paid, paidAt || "")}
      onUploadPaymentVoucher={(cost, file) => {
        if (file) void uploadPaymentVoucher(cost, file);
      }}
      onDeleteDocument={(cost, document) => void deleteCostDocument(cost, document)}
      onCloseVoucherPreview={() => setVoucherPreviewCost(null)}
      onCancelConfirmation={cancelConfirmation}
      onConfirmConfirmation={confirmConfirmation}
      onUpdateConfirmationInput={updateConfirmationInput}
    />
  );
}
