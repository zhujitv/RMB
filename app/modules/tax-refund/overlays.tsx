import type { FormEvent } from "react";
import {
  ConfirmationDialog,
  type ConfirmationDialogState,
} from "../../components";
import {
  CustomsFilePickerDialog,
  ManualShippingDocumentsDialog,
  SupplierDocumentRequestDialog,
  TaxRefundDetailDrawer,
} from "./detail-components";
import type {
  CustomsFilePickerState,
  ManualShippingDraft,
  ManualShippingForm,
  SupplierDocumentRequestForm,
  TaxDocument,
  TaxRefundDetail,
  TaxRefundRow,
  UploadScope,
} from "./model";

type TaxRefundOverlaysProps = {
  detailRow: TaxRefundRow | null;
  detail: TaxRefundDetail | null;
  detailOrderId: string;
  detailLoading: boolean;
  detailError: string;
  readOnly: boolean;
  packageDownloadingId: string;
  submittingTaxId: string;
  cancelingArchiveId: string;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  recognizingDocumentId: string;
  recognitionStatusByDocument: Record<string, string>;
  canSendShippingDocuments: boolean;
  canCreateSupplierDocumentRequest: boolean;
  canWriteDocuments: boolean;
  currentUserRole: string;
  customsFilePicker: CustomsFilePickerState;
  manualShippingOrder: TaxRefundDetail | null;
  manualShippingDraft: ManualShippingDraft | null;
  manualShippingForm: ManualShippingForm | null;
  manualShippingLoading: boolean;
  manualShippingSending: boolean;
  manualShippingMessage: string;
  supplierDocumentForm: SupplierDocumentRequestForm | null;
  supplierDocumentSending: boolean;
  supplierDocumentSubmitProgress: number;
  confirmation: ConfirmationDialogState | null;
  onCloseDetailDrawer: () => void;
  onDownloadPackage: (row: TaxRefundRow) => void;
  onSubmitTaxRefund: (row: TaxRefundRow) => void;
  onCancelArchive: (row: TaxRefundRow) => void;
  onCustomsSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => Promise<void> | void;
  onDelete: (orderId: string, document: TaxDocument) => Promise<void> | void;
  onRecognizeCustomsDocument: (order: TaxRefundDetail, document?: TaxDocument) => Promise<void> | void;
  onRecognizeFromUploadedCustoms: (order: TaxRefundDetail) => void;
  onOpenManualShippingDocuments: (order: TaxRefundDetail) => void;
  onOpenSupplierDocumentRequest: (order: TaxRefundDetail) => void;
  onOpenDomesticLogistics: () => void;
  onCloseCustomsFilePicker: () => void;
  onSelectCustomsFile: (order: TaxRefundDetail, document: TaxDocument) => void;
  onCloseManualShippingDocuments: () => void;
  onSubmitManualShippingDocuments: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onChangeManualShippingForm: (form: ManualShippingForm | null) => void;
  onManualShippingLanguageChange: (language: string) => void;
  onCloseSupplierDocumentRequest: () => void;
  onChangeSupplierDocumentForm: (form: SupplierDocumentRequestForm | null) => void;
  onSubmitSupplierDocumentRequest: (event: FormEvent<HTMLFormElement>) => Promise<void> | void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
};

export function TaxRefundOverlays({
  detailRow,
  detail,
  detailOrderId,
  detailLoading,
  detailError,
  readOnly,
  packageDownloadingId,
  submittingTaxId,
  cancelingArchiveId,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  recognizingDocumentId,
  recognitionStatusByDocument,
  canSendShippingDocuments,
  canCreateSupplierDocumentRequest,
  canWriteDocuments,
  currentUserRole,
  customsFilePicker,
  manualShippingOrder,
  manualShippingDraft,
  manualShippingForm,
  manualShippingLoading,
  manualShippingSending,
  manualShippingMessage,
  supplierDocumentForm,
  supplierDocumentSending,
  supplierDocumentSubmitProgress,
  confirmation,
  onCloseDetailDrawer,
  onDownloadPackage,
  onSubmitTaxRefund,
  onCancelArchive,
  onCustomsSaved,
  onUpload,
  onDelete,
  onRecognizeCustomsDocument,
  onRecognizeFromUploadedCustoms,
  onOpenManualShippingDocuments,
  onOpenSupplierDocumentRequest,
  onOpenDomesticLogistics,
  onCloseCustomsFilePicker,
  onSelectCustomsFile,
  onCloseManualShippingDocuments,
  onSubmitManualShippingDocuments,
  onChangeManualShippingForm,
  onManualShippingLanguageChange,
  onCloseSupplierDocumentRequest,
  onChangeSupplierDocumentForm,
  onSubmitSupplierDocumentRequest,
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
          error={detailOrderId === detailRow.id ? detailError : ""}
          readOnly={readOnly}
          packageDownloading={packageDownloadingId === detailRow.id}
          submittingTax={submittingTaxId === detailRow.id}
          cancelingArchive={cancelingArchiveId === detailRow.id}
          uploadingKey={uploadingKey}
          uploadProgressByKey={uploadProgressByKey}
          deletingDocumentId={deletingDocumentId}
          recognizingDocumentId={recognizingDocumentId}
          recognitionStatusByDocument={recognitionStatusByDocument}
          canSendShippingDocuments={canSendShippingDocuments}
          onClose={onCloseDetailDrawer}
          onDownloadPackage={() => onDownloadPackage(detailRow)}
          onSubmitTaxRefund={() => onSubmitTaxRefund(detailRow)}
          onCancelArchive={() => onCancelArchive(detailRow)}
          onCustomsSaved={onCustomsSaved}
          onUpload={onUpload}
          onDelete={onDelete}
          onRecognizeCustomsDocument={onRecognizeCustomsDocument}
          onRecognizeFromUploadedCustoms={onRecognizeFromUploadedCustoms}
          onOpenManualShippingDocuments={onOpenManualShippingDocuments}
          canCreateSupplierDocumentRequest={canCreateSupplierDocumentRequest}
          onOpenSupplierDocumentRequest={onOpenSupplierDocumentRequest}
          onOpenDomesticLogistics={onOpenDomesticLogistics}
          currentUserRole={currentUserRole}
          canWriteDocuments={canWriteDocuments}
        />
      ) : null}
      {customsFilePicker ? (
        <CustomsFilePickerDialog
          state={customsFilePicker}
          recognizingDocumentId={recognizingDocumentId}
          onClose={onCloseCustomsFilePicker}
          onSelect={onSelectCustomsFile}
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
      {supplierDocumentForm ? (
        <SupplierDocumentRequestDialog
          form={supplierDocumentForm}
          sending={supplierDocumentSending}
          submitProgress={supplierDocumentSubmitProgress}
          onClose={onCloseSupplierDocumentRequest}
          onChange={onChangeSupplierDocumentForm}
          onSubmit={onSubmitSupplierDocumentRequest}
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
