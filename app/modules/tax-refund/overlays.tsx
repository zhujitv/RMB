import {
  ConfirmationDialog,
  type ConfirmationDialogState,
} from "../../components";
import {
  TaxRefundDetailDrawer,
} from "./detail-components";
import type {
  TaxDocument,
  TaxRefundDetail,
  TaxRefundDetailTab,
  TaxRefundRow,
  UploadScope,
} from "./model";

type TaxRefundOverlaysProps = {
  detailRow: TaxRefundRow | null;
  detail: TaxRefundDetail | null;
  detailOrderId: string;
  detailLoading: boolean;
  detailActiveTab: TaxRefundDetailTab;
  detailLoadedSections: Record<TaxRefundDetailTab, boolean>;
  detailSectionLoading: Record<TaxRefundDetailTab, boolean>;
  detailError: string;
  readOnly: boolean;
  packageDownloadingId: string;
  submittingTaxId: string;
  cancelingArchiveId: string;
  refreshingCompletenessId: string;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  canRefreshCompleteness: boolean;
  canWriteDocuments: boolean;
  currentUserRole: string;
  confirmation: ConfirmationDialogState | null;
  onCloseDetailDrawer: () => void;
  onSelectDetailTab: (tab: TaxRefundDetailTab) => void;
  onDownloadPackage: (row: TaxRefundRow) => void;
  onSubmitTaxRefund: (row: TaxRefundRow) => void;
  onCancelArchive: (row: TaxRefundRow) => void;
  onRefreshCompleteness: (row: TaxRefundRow) => void;
  onCustomsSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => Promise<void> | void;
  onDelete: (orderId: string, document: TaxDocument) => Promise<void> | void;
  onOpenSupplierDocuments: (keyword: string) => void;
  onOpenDomesticLogistics: () => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
};

export function TaxRefundOverlays({
  detailRow,
  detail,
  detailOrderId,
  detailLoading,
  detailActiveTab,
  detailLoadedSections,
  detailSectionLoading,
  detailError,
  readOnly,
  packageDownloadingId,
  submittingTaxId,
  cancelingArchiveId,
  refreshingCompletenessId,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  canRefreshCompleteness,
  canWriteDocuments,
  currentUserRole,
  confirmation,
  onCloseDetailDrawer,
  onSelectDetailTab,
  onDownloadPackage,
  onSubmitTaxRefund,
  onCancelArchive,
  onRefreshCompleteness,
  onCustomsSaved,
  onUpload,
  onDelete,
  onOpenSupplierDocuments,
  onOpenDomesticLogistics,
  onCancelConfirmation,
  onConfirmConfirmation,
  onUpdateConfirmationInput,
}: TaxRefundOverlaysProps) {
  return (
    <>
      {detailRow ? (
        <TaxRefundDetailDrawer
          row={detailRow}
          detail={detailOrderId === detailRow.id ? detail : null}
          loading={detailOrderId === detailRow.id && detailLoading}
          activeTab={detailActiveTab}
          loadedSections={detailLoadedSections}
          sectionLoading={detailSectionLoading}
          error={detailOrderId === detailRow.id ? detailError : ""}
          readOnly={readOnly}
          packageDownloading={packageDownloadingId === detailRow.id}
          submittingTax={submittingTaxId === detailRow.id}
          cancelingArchive={cancelingArchiveId === detailRow.id}
          refreshingCompleteness={refreshingCompletenessId === detailRow.id}
          uploadingKey={uploadingKey}
          uploadProgressByKey={uploadProgressByKey}
          deletingDocumentId={deletingDocumentId}
          canRefreshCompleteness={canRefreshCompleteness}
          onClose={onCloseDetailDrawer}
          onSelectTab={onSelectDetailTab}
          onDownloadPackage={() => onDownloadPackage(detailRow)}
          onSubmitTaxRefund={() => onSubmitTaxRefund(detailRow)}
          onCancelArchive={() => onCancelArchive(detailRow)}
          onRefreshCompleteness={() => onRefreshCompleteness(detailRow)}
          onCustomsSaved={onCustomsSaved}
          onUpload={onUpload}
          onDelete={onDelete}
          onOpenSupplierDocuments={onOpenSupplierDocuments}
          onOpenDomesticLogistics={onOpenDomesticLogistics}
          currentUserRole={currentUserRole}
          canWriteDocuments={canWriteDocuments}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={onCancelConfirmation}
          onConfirm={onConfirmConfirmation}
          onInputChange={onUpdateConfirmationInput}
        />
      ) : null}
    </>
  );
}
