import type { Dispatch, SetStateAction } from "react";
import type { ConfirmationDialogState, ConfirmationResult } from "../../components";
import type {
  CostFilters,
  CostFormDrawerState,
  CostInvoiceGroupRow,
  CostOrderSummary,
  CostRow,
  CostView,
} from "./model";

export type CostActionsContext = {
  rows: CostRow[];
  setRows: Dispatch<SetStateAction<CostRow[]>>;
  setOrderRows: Dispatch<SetStateAction<CostOrderSummary[]>>;
  setDetailCost: Dispatch<SetStateAction<CostRow | null>>;
  setDetailOrderSummary: Dispatch<SetStateAction<CostOrderSummary | null>>;
  setDetailInvoiceGroup: Dispatch<SetStateAction<CostInvoiceGroupRow | null>>;
  setCostFormDrawer: Dispatch<SetStateAction<CostFormDrawerState | null>>;
  setDocumentCost: Dispatch<SetStateAction<CostRow | null>>;
  setDocumentLoading: Dispatch<SetStateAction<boolean>>;
  setDocumentError: Dispatch<SetStateAction<string>>;
  setUploadingKey: Dispatch<SetStateAction<string>>;
  setPaymentSavingId: Dispatch<SetStateAction<string>>;
  setCostTypeSavingId: Dispatch<SetStateAction<string>>;
  setVoucherUploadingKey: Dispatch<SetStateAction<string>>;
  setVoucherPreviewCost: Dispatch<SetStateAction<CostRow | null>>;
  setUploadProgressByKey: Dispatch<SetStateAction<Record<string, number>>>;
  setDeletingDocumentId: Dispatch<SetStateAction<string>>;
  setDeletingId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  costView: CostView;
  page: number;
  submittedFilters: CostFilters;
  archiveScope: string;
  canManageFactoryPayments: boolean;
  loadCosts: (
    nextPage?: number,
    nextFilters?: CostFilters,
    nextArchiveScope?: string,
    nextView?: CostView,
    options?: { silent?: boolean },
  ) => Promise<void>;
  requestConfirmation: (options: ConfirmationDialogState) => Promise<ConfirmationResult>;
};
