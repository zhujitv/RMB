import type { FormEvent } from "react";
import {
  ConfirmationDialog,
  type ConfirmationDialogState,
} from "../../components";
import {
  ManualShippingDocumentsDialog,
  TaxRefundDetailDrawer,
} from "./detail-components";
import type {
  ManualShippingDraft,
  ManualShippingForm,
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
  canSendShippingDocuments: boolean;
  canRefreshCompleteness: boolean;
  canWriteDocuments: boolean;
  currentUserRole: string;
  manualShippingOrder: TaxRefundDetail | null;
  manualShippingDraft: ManualShippingDraft | null;
  manualShippingForm: ManualShippingForm | null;
  manualShippingLoading: boolean;
  manualShippingSending: boolean;
  manualShippingMessage: string;
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
  onOpenManualShippingDocuments: (order: TaxRefundDetail) => void;
  onOpenSupplierDocuments: (keyword: string) => void;
  onOpenDomesticLogistics: () => void;
  onCloseManualShippingDocuments: () => void;
  onSubmitManualShippingDocuments: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onChangeManualShippingForm: (form: ManualShippingForm | null) => void;
  onManualShippingLanguageChange: (language: string) => void;
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
  canSendShippingDocuments,
  canRefreshCompleteness,
  canWriteDocuments,
  currentUserRole,
  manualShippingOrder,
  manualShippingDraft,
  manualShippingForm,
  manualShippingLoading,
  manualShippingSending,
  manualShippingMessage,
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
  onOpenManualShippingDocuments,
  onOpenSupplierDocuments,
  onOpenDomesticLogistics,
  onCloseManualShippingDocuments,
  onSubmitManualShippingDocuments,
  onChangeManualShippingForm,
  onManualShippingLanguageChange,
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
          canSendShippingDocuments={canSendShippingDocuments}
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
          onOpenManualShippingDocuments={onOpenManualShippingDocuments}
          onOpenSupplierDocuments={onOpenSupplierDocuments}
          onOpenDomesticLogistics={onOpenDomesticLogistics}
          currentUserRole={currentUserRole}
          canWriteDocuments={canWriteDocuments}
        />
      ) : null}
      {manualShippingOrder ? (
        <ManualShippingDocumentsDialog
          order={manualShippingOrder}
          draft={manualShippingDraft}
          form={manualShippingForm}
          loading={manualShippingLoading}
          sending={manualShippingSending}
          message={manualShippingMessage}
          onClose={onCloseManualShippingDocuments}
          onSubmit={onSubmitManualShippingDocuments}
          onChange={onChangeManualShippingForm}
          onLanguageChange={onManualShippingLanguageChange}
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
