"use client";

import styles from "../WorkspaceShell.module.css";
import { TaxRefundListPanel } from "./tax-refund/list-panel";
import { TaxRefundOverlays } from "./tax-refund/overlays";
import { type TaxRefundModuleProps, useTaxRefundController } from "./tax-refund/use-tax-refund-controller";

export function TaxRefundModule(props: TaxRefundModuleProps) {
  const taxRefund = useTaxRefundController(props);

  return (
    <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <TaxRefundListPanel
        mode={taxRefund.mode}
        rows={taxRefund.rows}
        total={taxRefund.total}
        page={taxRefund.page}
        totalPages={taxRefund.totalPages}
        loading={taxRefund.loading}
        error={taxRefund.error}
        notice={taxRefund.notice}
        keyword={taxRefund.keyword}
        declarationStartMonth={taxRefund.declarationStartMonth}
        declarationEndMonth={taxRefund.declarationEndMonth}
        statusFilter={taxRefund.statusFilter}
        businessEntityId={taxRefund.businessEntityId}
        businessEntitySortDirection={taxRefund.businessEntitySortDirection}
        businessEntities={taxRefund.businessEntities}
        canSortBusinessEntity={taxRefund.currentUserRole === "管理员"}
        canManageTaxRefund={taxRefund.canManageTaxRefund}
        canCancelArchive={taxRefund.canCancelArchive}
        submittingTaxId={taxRefund.submittingTaxId}
        onRefresh={taxRefund.refreshRows}
        onSwitchMode={taxRefund.switchMode}
        onKeywordChange={taxRefund.setKeyword}
        onDeclarationStartMonthChange={taxRefund.setDeclarationStartMonth}
        onDeclarationEndMonthChange={taxRefund.setDeclarationEndMonth}
        onStatusFilterChange={taxRefund.setStatusFilter}
        onBusinessEntityChange={taxRefund.setBusinessEntityId}
        onToggleBusinessEntitySort={taxRefund.toggleBusinessEntitySort}
        onSubmitSearch={taxRefund.submitSearch}
        onResetSearch={taxRefund.resetSearch}
        onPage={taxRefund.gotoPage}
        onViewDetail={(row) => void taxRefund.loadDetail(row)}
        onSubmitTaxRefund={(row) => void taxRefund.submitTaxRefund(row)}
        onCancelArchive={(row) => void taxRefund.cancelTaxRefundArchive(row)}
        onUpdateStatus={(row, status) => void taxRefund.updateTaxRefundStatus(row, status)}
      />

      <TaxRefundOverlays
        detailRow={taxRefund.detailRow}
        detail={taxRefund.detail}
        detailOrderId={taxRefund.detailOrderId}
        detailLoading={taxRefund.detailLoading}
        detailError={taxRefund.detailError}
        readOnly={taxRefund.readOnly}
        packageDownloadingId={taxRefund.packageDownloadingId}
        submittingTaxId={taxRefund.submittingTaxId}
        cancelingArchiveId={taxRefund.cancelingArchiveId}
        refreshingCompletenessId={taxRefund.refreshingCompletenessId}
        uploadingKey={taxRefund.uploadingKey}
        uploadProgressByKey={taxRefund.uploadProgressByKey}
        deletingDocumentId={taxRefund.deletingDocumentId}
        recognizingDocumentId={taxRefund.recognizingDocumentId}
        recognitionStatusByDocument={taxRefund.recognitionStatusByDocument}
        canSendShippingDocuments={taxRefund.canSendShippingDocuments}
        canCreateSupplierDocumentRequest={taxRefund.canCreateSupplierDocumentRequest}
        canRefreshCompleteness={taxRefund.canManageTaxRefund}
        canWriteDocuments={taxRefund.canWriteDocuments}
        currentUserRole={taxRefund.currentUserRole}
        customsFilePicker={taxRefund.customsFilePicker}
        manualShippingOrder={taxRefund.manualShippingOrder}
        manualShippingDraft={taxRefund.manualShippingDraft}
        manualShippingForm={taxRefund.manualShippingForm}
        manualShippingLoading={taxRefund.manualShippingLoading}
        manualShippingSending={taxRefund.manualShippingSending}
        manualShippingMessage={taxRefund.manualShippingMessage}
        supplierDocumentForm={taxRefund.supplierDocumentForm}
        supplierDocumentSending={taxRefund.supplierDocumentSending}
        supplierDocumentSubmitProgress={taxRefund.supplierDocumentSubmitProgress}
        confirmation={taxRefund.confirmation}
        onCloseDetailDrawer={taxRefund.closeDetailDrawer}
        onDownloadPackage={(row) => void taxRefund.downloadPackage(row)}
        onSubmitTaxRefund={(row) => void taxRefund.submitTaxRefund(row)}
        onCancelArchive={(row) => void taxRefund.cancelTaxRefundArchive(row)}
        onRefreshCompleteness={(row) => void taxRefund.refreshCompleteness(row)}
        onCustomsSaved={taxRefund.handleCustomsSaved}
        onUpload={taxRefund.uploadDocument}
        onDelete={taxRefund.deleteDocument}
        onRecognizeCustomsDocument={taxRefund.recognizeCustomsDocument}
        onRecognizeFromUploadedCustoms={taxRefund.recognizeFromUploadedCustoms}
        onOpenManualShippingDocuments={taxRefund.openManualShippingDocuments}
        onOpenSupplierDocumentRequest={taxRefund.openSupplierDocumentRequest}
        onOpenDomesticLogistics={taxRefund.openDomesticLogisticsFromDetail}
        onCloseCustomsFilePicker={taxRefund.closeCustomsFilePicker}
        onSelectCustomsFile={taxRefund.selectCustomsFile}
        onCloseManualShippingDocuments={taxRefund.closeManualShippingDocuments}
        onSubmitManualShippingDocuments={taxRefund.sendManualShippingDocuments}
        onChangeManualShippingForm={taxRefund.setManualShippingForm}
        onManualShippingLanguageChange={taxRefund.updateManualShippingLanguage}
        onCloseSupplierDocumentRequest={taxRefund.closeSupplierDocumentRequest}
        onChangeSupplierDocumentForm={taxRefund.setSupplierDocumentForm}
        onSubmitSupplierDocumentRequest={taxRefund.submitSupplierDocumentRequest}
        onCancelConfirmation={taxRefund.cancelConfirmation}
        onConfirmConfirmation={taxRefund.confirmConfirmation}
        onUpdateConfirmationInput={taxRefund.updateConfirmationInput}
      />
    </section>
  );
}
