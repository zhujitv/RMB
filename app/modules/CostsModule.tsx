"use client";

import { useCallback, useState } from "react";
import { useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import { hasPaymentVoucher } from "./costs/helpers";
import { CostsModuleView } from "./costs/module-view";
import { PAGE_SIZE, type CostFormDrawerState, type CostInvoiceGroupRow, type CostOrderSummary, type CostRow } from "./costs/model";
import { useCostDocumentActions } from "./costs/use-cost-document-actions";
import { useCostsListController } from "./costs/use-costs-list-controller";

export function CostsModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialOpenToken?: number;
}) {
  const [detailCost, setDetailCost] = useState<CostRow | null>(null);
  const [detailOrderSummary, setDetailOrderSummary] = useState<CostOrderSummary | null>(null);
  const [detailInvoiceGroup, setDetailInvoiceGroup] = useState<CostInvoiceGroupRow | null>(null);
  const [costFormDrawer, setCostFormDrawer] = useState<CostFormDrawerState | null>(null);
  const [returnDetailCost, setReturnDetailCost] = useState<CostRow | null>(null);
  const [documentCost, setDocumentCost] = useState<CostRow | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [paymentSavingId, setPaymentSavingId] = useState("");
  const [voucherUploadingKey, setVoucherUploadingKey] = useState("");
  const [voucherPreviewCost, setVoucherPreviewCost] = useState<CostRow | null>(null);
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canWriteDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "财务", "业务员"]);
  const canManageFactoryPayments = ["管理员", "财务"].includes(currentUser.role);
  const clearTransientState = useCallback(() => {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setReturnDetailCost(null);
  }, []);

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
    setInvoiceGroupRows,
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

  function openCreateCostDrawer() {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setDocumentCost(null);
    setReturnDetailCost(null);
    setCostFormDrawer({ mode: "create", cost: null });
  }

  function openEditCostDrawer(cost: CostRow, options: { returnToDetail?: boolean } = {}) {
    setReturnDetailCost(options.returnToDetail ? cost : null);
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setDocumentCost(null);
    setCostFormDrawer({ mode: "edit", cost });
  }

  function openPaymentVoucherPreview(cost: CostRow) {
    if (!hasPaymentVoucher(cost)) return;
    setVoucherPreviewCost(cost);
  }

  function closeCostFormDrawer() {
    if (returnDetailCost) setDetailCost(returnDetailCost);
    setReturnDetailCost(null);
    setCostFormDrawer(null);
  }

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
    updateProductSupplierCostPayment,
    uploadPaymentVoucher,
    deleteCostDocument,
    deleteCost,
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

  function closeDocumentsDrawer() {
    setDocumentCost(null);
    setDocumentError("");
    setUploadingKey("");
    setPaymentSavingId("");
    setVoucherUploadingKey("");
    setDeletingDocumentId("");
  }

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
      canManageFactoryPayments={canManageFactoryPayments}
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
      onDeleteCost={(cost) => void deleteCost(cost)}
      onOpenDocuments={(costId) => void openCostDocuments(costId)}
      onOpenInvoiceGroupDocuments={(group) => void openInvoiceGroupDocuments(group)}
      onOpenPaymentVoucher={openPaymentVoucherPreview}
      onCloseCostForm={closeCostFormDrawer}
      onCostFormSaved={handleCostFormSaved}
      onCloseDocuments={closeDocumentsDrawer}
      onUploadDocument={(cost, documentType, file) => {
        if (file) void uploadCostDocument(cost, documentType, file);
      }}
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
