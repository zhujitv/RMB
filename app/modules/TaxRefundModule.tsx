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
        businessEntities={taxRefund.businessEntities}
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
        detailActiveTab={taxRefund.detailActiveTab}
        detailLoadedSections={taxRefund.detailLoadedSections}
        detailSectionLoading={taxRefund.detailSectionLoading}
        detailError={taxRefund.detailError}
        readOnly={taxRefund.readOnly}
        packageDownloadingId={taxRefund.packageDownloadingId}
        submittingTaxId={taxRefund.submittingTaxId}
        cancelingArchiveId={taxRefund.cancelingArchiveId}
        refreshingCompletenessId={taxRefund.refreshingCompletenessId}
        uploadingKey={taxRefund.uploadingKey}
        uploadProgressByKey={taxRefund.uploadProgressByKey}
        deletingDocumentId={taxRefund.deletingDocumentId}
        canRefreshCompleteness={taxRefund.canManageTaxRefund}
        canWriteDocuments={taxRefund.canWriteDocuments}
        currentUserRole={taxRefund.currentUserRole}
        confirmation={taxRefund.confirmation}
        onCloseDetailDrawer={taxRefund.closeDetailDrawer}
        onSelectDetailTab={taxRefund.selectDetailTab}
        onDownloadPackage={(row) => void taxRefund.downloadPackage(row)}
        onSubmitTaxRefund={(row) => void taxRefund.submitTaxRefund(row)}
        onCancelArchive={(row) => void taxRefund.cancelTaxRefundArchive(row)}
        onRefreshCompleteness={(row) => void taxRefund.refreshCompleteness(row)}
        onCustomsSaved={taxRefund.handleCustomsSaved}
        onUpload={taxRefund.uploadDocument}
        onDelete={taxRefund.deleteDocument}
        onOpenSupplierDocuments={(keyword) => props.onOpenSupplierDocuments?.(keyword)}
        onOpenDomesticLogistics={taxRefund.openDomesticLogisticsFromDetail}
        onCancelConfirmation={taxRefund.cancelConfirmation}
        onConfirmConfirmation={taxRefund.confirmConfirmation}
        onUpdateConfirmationInput={taxRefund.updateConfirmationInput}
      />
    </section>
  );
}
