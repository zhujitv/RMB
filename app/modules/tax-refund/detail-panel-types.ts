import type {
  TaxDocument,
  TaxRefundDetail,
  TaxRefundDetailTab,
  TaxRefundRow,
  UploadScope,
} from "./model";

export type TaxRefundDetailPanelProps = {
  detail: TaxRefundDetail | null;
  loading: boolean;
  activeTab: TaxRefundDetailTab;
  loadedSections: Record<TaxRefundDetailTab, boolean>;
  sectionLoading: Record<TaxRefundDetailTab, boolean>;
  error: string;
  fallback: TaxRefundRow;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  readOnly: boolean;
  onCustomsSaved: (orderId: string, order?: TaxRefundDetail | null) => Promise<void>;
  onUpload: (orderId: string, documentType: string, file: File | null, scope?: UploadScope) => void;
  onDelete: (orderId: string, document: TaxDocument) => void;
  onOpenDomesticLogistics?: () => void;
  onOpenSupplierDocuments: (keyword: string) => void;
  currentUserRole: string;
  canWriteDocuments: boolean;
  onSelectTab: (tab: TaxRefundDetailTab) => void;
};
