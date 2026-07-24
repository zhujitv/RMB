import type { ConfirmationDialogState } from "../../components";
import type {
  CostFilters,
  CostFormDrawerState,
  CostInvoiceGroupRow,
  CostOrderSummary,
  CostRow,
  CostView,
} from "./model";

type CostDocument = NonNullable<CostRow["documents"]>[number];

export type CostsModuleViewProps = {
  rows: CostRow[];
  orderRows: CostOrderSummary[];
  invoiceGroupRows: CostInvoiceGroupRow[];
  activeRows: Array<CostRow | CostOrderSummary | CostInvoiceGroupRow>;
  filters: CostFilters;
  archiveScope: string;
  costView: CostView;
  loading: boolean;
  error: string;
  notice: string;
  total: number;
  page: number;
  totalPages: number;
  deletingId: string;
  selectedCostIds: string[];
  selectedVoidableCount: number;
  detailCost: CostRow | null;
  detailOrderSummary: CostOrderSummary | null;
  detailInvoiceGroup: CostInvoiceGroupRow | null;
  costFormDrawer: CostFormDrawerState | null;
  documentCost: CostRow | null;
  documentLoading: boolean;
  documentError: string;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  canWriteDocuments: boolean;
  canManageCostType: boolean;
  canManageFactoryPayments: boolean;
  costTypeSavingId: string;
  paymentSavingId: string;
  voucherUploadingKey: string;
  voucherPreviewCost: CostRow | null;
  confirmation: ConfirmationDialogState | null;
  onCreateCost: () => void;
  onRefresh: () => void;
  onChangeView: (view: CostView) => void;
  onChangeArchiveScope: (scope: string) => void;
  onSetFilter: <K extends keyof CostFilters>(key: K, value: CostFilters[K]) => void;
  onSubmitSearch: () => void;
  onResetSearch: () => void;
  onPage: (page: number) => void;
  onSetDetailCost: (cost: CostRow | null) => void;
  onSetOrderDetail: (order: CostOrderSummary | null) => void;
  onSetInvoiceGroupDetail: (group: CostInvoiceGroupRow | null) => void;
  onEditCost: (cost: CostRow, options?: { returnToDetail?: boolean }) => void;
  onCopyCost: (cost: CostRow) => void;
  onVoidCost: (cost: CostRow) => void;
  onDeleteCost: (cost: CostRow) => void;
  onRestoreCost: (cost: CostRow) => void;
  onToggleCostSelection: (costId: string, selected: boolean) => void;
  onToggleAllVisibleCosts: (selected: boolean) => void;
  onBatchVoid: () => void;
  onOpenDocuments: (costId: string) => void;
  onOpenInvoiceGroupDocuments: (group: CostInvoiceGroupRow) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onCloseCostForm: () => void;
  onCostFormSaved: (saved: CostRow | CostRow[] | null | undefined) => Promise<void>;
  onCloseDocuments: () => void;
  onUploadDocument: (cost: CostRow, documentType: string, file: File | null) => void;
  onUpdateCostType: (cost: CostRow, costType: string, reason: string) => void;
  onUpdatePayment: (cost: CostRow, paid: boolean, paidAt?: string) => void;
  onUploadPaymentVoucher: (cost: CostRow, file: File | null) => void;
  onDeleteDocument: (cost: CostRow, document: CostDocument) => void;
  onCloseVoucherPreview: () => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
};
