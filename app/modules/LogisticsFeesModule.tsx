"use client";

import { useState } from "react";
import { useConfirmationDialog } from "../components";
import { useLogisticsFeesBillActions } from "./logistics-fees/use-logistics-fees-bill-actions";
import { useLogisticsFeesListController } from "./logistics-fees/use-logistics-fees-list-controller";
import { useLogisticsFeesStatement } from "./logistics-fees/use-logistics-fees-statement";
import { LogisticsFeesModuleView } from "./logistics-fees/module-view";
import { logisticsExpenseShipmentBillIds } from "./logistics-fees/shared";

export function LogisticsFeesModule({
  embedded = false,
  title = "物流费用录入",
  initialStatus = "",
  sectionId = "",
  focusBillId = "",
  focusKeyword = "",
  focusToken = 0,
  hideCreateAction = false,
  refreshToken = 0,
  currentUserRole = "",
  currentUserSupplierId = "",
  canCreateExpense: canCreateExpenseProp,
  onRefreshTodos,
}: {
  embedded?: boolean;
  title?: string;
  initialStatus?: string;
  sectionId?: string;
  focusBillId?: string;
  focusKeyword?: string;
  focusToken?: number;
  hideCreateAction?: boolean;
  refreshToken?: number;
  currentUserRole?: string;
  currentUserSupplierId?: string;
  canCreateExpense?: boolean;
  onRefreshTodos?: () => Promise<void> | void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
    updateConfirmationSecondaryInput,
  } = useConfirmationDialog();
  const {
    statementMonth,
    setStatementMonth,
    statementRows,
    statementLoading,
    loadStatement,
    exportStatementCsv,
  } = useLogisticsFeesStatement({ setError, setNotice });
  const {
    rows,
    setRows,
    total,
    setTotal,
    page,
    keyword,
    setKeyword,
    submittedKeyword,
    status,
    setStatus,
    costType,
    setCostType,
    billStatus,
    setBillStatus,
    businessScope,
    setBusinessScope,
    expandedId,
    setExpandedId,
    loading,
    createOpen,
    setCreateOpen,
    selectedBillIds,
    setSelectedBillIds,
    totalPages,
    activeExpense,
    reviewableRows,
    selectedReviewableRows,
    allReviewableSelected,
    loadExpenses,
    submitSearch,
    resetSearch,
    toggleBillSelection,
    toggleAllReviewableBills,
  } = useLogisticsFeesListController({
    initialStatus,
    focusBillId,
    focusKeyword,
    focusToken,
    refreshToken,
    statementMonth,
    loadStatement,
    setError,
    setNotice,
  });
  const readOnlyArchive = businessScope === "archive";
  const canCreateExpense =
    !readOnlyArchive &&
    !hideCreateAction &&
    (canCreateExpenseProp ??
      ["管理员", "物流供应商"].includes(currentUserRole));
  const canReviewExpense = !readOnlyArchive && currentUserRole === "管理员";
  const canConfirmInvoice = !readOnlyArchive && ["管理员", "财务"].includes(currentUserRole);
  const isLogisticsSupplier = currentUserRole === "物流供应商";

  const {
    busyId,
    deletingId,
    savingBillId,
    applyLogisticsExpenseMutationResult,
    reviewExpenseBills,
    reviewSelectedBills,
    saveBillDetails,
    withdrawExpense,
    submitDraftExpenseBill,
    rejectExpense,
    resendInvoiceNotice,
    markExpenseBillPaid,
    reverseExpenseBillPayment,
    voidExpenseBill,
  } = useLogisticsFeesBillActions({
    rows,
    setRows,
    setTotal,
    selectedReviewableRows,
    setSelectedBillIds,
    expandedId,
    setExpandedId,
    page,
    submittedKeyword,
    status,
    costType,
    billStatus,
    statementMonth,
    loadExpenses,
    loadStatement,
    setError,
    setNotice,
    requestConfirmation,
    onRefreshTodos,
  });

  return (
    <LogisticsFeesModuleView
      embedded={embedded}
      title={title}
      sectionId={sectionId}
      rows={rows}
      total={total}
      page={page}
      totalPages={totalPages}
      keyword={keyword}
      status={status}
      costType={costType}
      billStatus={billStatus}
      businessScope={businessScope}
      readOnlyArchive={readOnlyArchive}
      expandedId={expandedId}
      loading={loading}
      error={error}
      notice={notice}
      createOpen={createOpen}
      selectedBillIds={selectedBillIds}
      canCreateExpense={canCreateExpense}
      canReviewExpense={canReviewExpense}
      canConfirmInvoice={canConfirmInvoice}
      isLogisticsSupplier={isLogisticsSupplier && !readOnlyArchive}
      reviewableRows={reviewableRows}
      selectedReviewableRows={selectedReviewableRows}
      allReviewableSelected={allReviewableSelected}
      activeExpense={activeExpense}
      currentUserRole={currentUserRole}
      currentUserSupplierId={currentUserSupplierId}
      statementMonth={statementMonth}
      statementRows={statementRows}
      statementLoading={statementLoading}
      busyId={busyId}
      deletingId={deletingId}
      savingBillId={savingBillId}
      confirmation={confirmation}
      onToggleCreate={() => {
        setNotice("");
        setCreateOpen((open) => !open);
      }}
      onRefresh={() => {
        setNotice("");
        void loadExpenses(page, submittedKeyword, status, costType, billStatus, businessScope);
      }}
      onCancelCreate={() => setCreateOpen(false)}
      onCreateSaved={(message) => {
        setCreateOpen(false);
        setExpandedId("");
        setNotice(message || "物流费用已保存");
        void loadExpenses(1, submittedKeyword, status, costType, billStatus, businessScope);
        void loadStatement(statementMonth);
        void onRefreshTodos?.();
      }}
      setStatementMonth={setStatementMonth}
      loadStatement={loadStatement}
      exportStatementCsv={exportStatementCsv}
      onKeywordChange={setKeyword}
      onSubmitSearch={submitSearch}
      onStatusChange={(nextStatus) => {
        setStatus(nextStatus);
        setNotice("");
        void loadExpenses(1, submittedKeyword, nextStatus, costType, billStatus, businessScope);
      }}
      onCostTypeChange={(nextCostType) => {
        setCostType(nextCostType);
        setNotice("");
        void loadExpenses(1, submittedKeyword, status, nextCostType, billStatus, businessScope);
      }}
      onBillStatusChange={(nextBillStatus) => {
        setBillStatus(nextBillStatus);
        setNotice("");
        void loadExpenses(1, submittedKeyword, status, costType, nextBillStatus, businessScope);
      }}
      onBusinessScopeChange={(nextScope) => {
        setBusinessScope(nextScope);
        setCreateOpen(false);
        setExpandedId("");
        setSelectedBillIds([]);
        setNotice("");
        void loadExpenses(1, submittedKeyword, status, costType, billStatus, nextScope);
      }}
      onResetSearch={resetSearch}
      onReviewSelectedBills={() => void reviewSelectedBills()}
      onToggleAllReviewableBills={toggleAllReviewableBills}
      onOpenExpense={(expense) => setExpandedId(expense.id)}
      onSelectBill={toggleBillSelection}
      onPage={(nextPage) => {
        setExpandedId("");
        setNotice("");
        void loadExpenses(nextPage, submittedKeyword, status, costType, billStatus, businessScope);
      }}
      onCloseExpense={() => setExpandedId("")}
      onApprove={(item) => void reviewExpenseBills(logisticsExpenseShipmentBillIds(item), item)}
      onReject={(item) => void rejectExpense(item)}
      onWithdraw={(item) => void withdrawExpense(item)}
      onResendInvoiceNotice={(item) => void resendInvoiceNotice(item)}
      onMarkPaid={(item) => void markExpenseBillPaid(item)}
      onReversePayment={(item) => void reverseExpenseBillPayment(item)}
      onSubmitDraft={(item) => void submitDraftExpenseBill(item)}
      onVoidBill={(item) => void voidExpenseBill(item)}
      onSaveDetails={(payload) => saveBillDetails(activeExpense!, payload)}
      onValidationError={(message) => {
        setError(message);
        setNotice("");
      }}
      onInvoiceUploaded={(result) => {
        applyLogisticsExpenseMutationResult(result);
        setNotice(result.message || "上传成功");
        void loadStatement(statementMonth);
        void onRefreshTodos?.();
      }}
      onCancelConfirmation={cancelConfirmation}
      onConfirmConfirmation={confirmConfirmation}
      onUpdateConfirmationInput={updateConfirmationInput}
      onUpdateConfirmationSecondaryInput={updateConfirmationSecondaryInput}
    />
  );
}
